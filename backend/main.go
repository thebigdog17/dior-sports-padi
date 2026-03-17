package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/gorilla/mux"
	"github.com/joho/godotenv"
	"github.com/rs/cors"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"google.golang.org/api/option"
)

// ─── CONFIG ───────────────────────────────────────────────────────
var (
	mongoURI          string
	rapidAPIKey       string
	geminiKey         string
	firebaseCredsPath string
	port              string
)

func initConfig() {
	godotenv.Load()
	mongoURI          = mustEnv("MONGO_URI")
	rapidAPIKey       = mustEnv("RAPIDAPI_KEY")
	geminiKey         = mustEnv("GEMINI_API_KEY")
	firebaseCredsPath = getEnv("FIREBASE_CREDS", "./firebase-credentials.json")
	port              = getEnv("PORT", "8080")
}

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" { log.Fatalf("Missing env var: %s", k) }
	return v
}
func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" { return v }
	return def
}

// ─── CACHE ────────────────────────────────────────────────────────
type cacheItem struct {
	data      []byte
	expiresAt time.Time
}
type Cache struct {
	mu    sync.RWMutex
	items map[string]cacheItem
}
func NewCache() *Cache { return &Cache{items: make(map[string]cacheItem)} }
func (c *Cache) Get(k string) ([]byte, bool) {
	c.mu.RLock(); defer c.mu.RUnlock()
	it, ok := c.items[k]
	if !ok || time.Now().After(it.expiresAt) { return nil, false }
	return it.data, true
}
func (c *Cache) Set(k string, d []byte, ttl time.Duration) {
	c.mu.Lock(); defer c.mu.Unlock()
	c.items[k] = cacheItem{data: d, expiresAt: time.Now().Add(ttl)}
}

// ─── MODELS ───────────────────────────────────────────────────────
type User struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	FirebaseUID string             `bson:"firebaseUid"   json:"firebaseUid"`
	Email       string             `bson:"email"         json:"email"`
	Name        string             `bson:"name"          json:"name"`
	CreatedAt   time.Time          `bson:"createdAt"     json:"createdAt"`
}

type SavedTicket struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID    string             `bson:"userId"        json:"userId"`
	Date      string             `bson:"date"          json:"date"`
	Markets   []string           `bson:"markets"       json:"markets"`
	Content   string             `bson:"content"       json:"content"`
	CreatedAt time.Time          `bson:"createdAt"     json:"createdAt"`
}

// ─── NORMALISED FIXTURE (common format for frontend) ──────────────
type Fixture struct {
	ID         string `json:"id"`
	HomeTeam   string `json:"home_name"`
	AwayTeam   string `json:"away_name"`
	HomeScore  *int   `json:"home_score"`
	AwayScore  *int   `json:"away_score"`
	Status     string `json:"status"`
	Date       string `json:"date"`
	Time       string `json:"time"`
	LeagueName string `json:"league_name"`
	LeagueLogo string `json:"league_logo"`
	Country    string `json:"country"`
}

// ─── SERVER ───────────────────────────────────────────────────────
type Server struct {
	db         *mongo.Database
	cache      *Cache
	fireAuth   *auth.Client
	httpClient *http.Client
}

func NewServer(db *mongo.Database, fa *auth.Client) *Server {
	return &Server{
		db:       db,
		cache:    NewCache(),
		fireAuth: fa,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			jsonErr(w, "Missing token", 401); return
		}
		token, err := s.fireAuth.VerifyIDToken(r.Context(), strings.TrimPrefix(header, "Bearer "))
		if err != nil { jsonErr(w, "Invalid token", 401); return }
		ctx := context.WithValue(r.Context(), "uid", token.UID)
		next(w, r.WithContext(ctx))
	}
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

// ─── HEALTH ───────────────────────────────────────────────────────
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]interface{}{"status": "ok", "timestamp": time.Now().UTC()})
}

// ─── AUTH ─────────────────────────────────────────────────────────
func (s *Server) handleRegisterProfile(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("uid").(string)
	var body struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	fireUser, err := s.fireAuth.GetUser(r.Context(), uid)
	if err != nil { jsonErr(w, "Firebase user not found", 400); return }

	email := fireUser.Email
	if email == "" { email = body.Email }

	col := s.db.Collection("users")
	filter := bson.M{"firebaseUid": uid}
	update := bson.M{
		"$set": bson.M{
			"firebaseUid": uid,
			"email":       email,
			"name":        body.Name,
			"updatedAt":   time.Now(),
		},
		"$setOnInsert": bson.M{"createdAt": time.Now()},
	}
	col.UpdateOne(r.Context(), filter, update, options.Update().SetUpsert(true))
	var user User
	col.FindOne(r.Context(), filter).Decode(&user)
	jsonOK(w, user)
}

func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("uid").(string)
	var user User
	err := s.db.Collection("users").FindOne(r.Context(), bson.M{"firebaseUid": uid}).Decode(&user)
	if err != nil { jsonErr(w, "User not found", 404); return }
	jsonOK(w, user)
}

// ─── SCORES: TheSportsDB (free, no key, 100s of leagues) ─────────
func (s *Server) fetchTSDB(date string) ([]Fixture, error) {
	cacheKey := "tsdb:" + date
	if cached, ok := s.cache.Get(cacheKey); ok {
		var fixtures []Fixture
		json.Unmarshal(cached, &fixtures)
		return fixtures, nil
	}

	url := fmt.Sprintf("https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=%s&s=Soccer", date)
	resp, err := s.httpClient.Get(url)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var tsdbResp struct {
		Events []struct {
			IDEvent       string `json:"idEvent"`
			StrHomeTeam   string `json:"strHomeTeam"`
			StrAwayTeam   string `json:"strAwayTeam"`
			IntHomeScore  *int   `json:"intHomeScore,string"`
			IntAwayScore  *int   `json:"intAwayScore,string"`
			StrStatus     string `json:"strStatus"`
			DateEvent     string `json:"dateEvent"`
			StrTime       string `json:"strTime"`
			StrLeague     string `json:"strLeague"`
			StrLeagueBadge string `json:"strLeagueBadge"`
			StrCountry    string `json:"strCountry"`
			StrProgress   string `json:"strProgress"`
		} `json:"events"`
	}

	if err := json.Unmarshal(body, &tsdbResp); err != nil {
		return nil, err
	}

	var fixtures []Fixture
	for _, e := range tsdbResp.Events {
		status := "NS"
		switch e.StrStatus {
		case "Match Finished", "FT", "AET", "PEN":
			status = "FT"
		case "In Progress", "HT":
			status = e.StrStatus
		case "Postponed":
			status = "POSTPONED"
		default:
			if e.StrProgress != "" {
				status = "IN_PLAY"
			}
		}
		fixtures = append(fixtures, Fixture{
			ID:         "tsdb_" + e.IDEvent,
			HomeTeam:   e.StrHomeTeam,
			AwayTeam:   e.StrAwayTeam,
			HomeScore:  e.IntHomeScore,
			AwayScore:  e.IntAwayScore,
			Status:     status,
			Date:       e.DateEvent,
			Time:       e.StrTime,
			LeagueName: e.StrLeague,
			LeagueLogo: e.StrLeagueBadge,
			Country:    e.StrCountry,
		})
	}

	if len(fixtures) > 0 {
		data, _ := json.Marshal(fixtures)
		s.cache.Set(cacheKey, data, 60*time.Second)
	}
	return fixtures, nil
}

// Also try the Free Livescore API as secondary source
func (s *Server) fetchLivescoreAPI(date string) ([]Fixture, error) {
	cacheKey := "ls2:" + date
	if cached, ok := s.cache.Get(cacheKey); ok {
		var fixtures []Fixture
		json.Unmarshal(cached, &fixtures)
		return fixtures, nil
	}

	// Try multiple endpoints from the free livescore API
	url := "https://free-livescore-api.p.rapidapi.com/livescore-get?sportname=soccer"
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Set("x-rapidapi-key", rapidAPIKey)
	req.Header.Set("x-rapidapi-host", "free-livescore-api.p.rapidapi.com")

	resp, err := s.httpClient.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	// Parse the response - try different possible formats
	var result map[string]interface{}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, err
	}

	var fixtures []Fixture

	// Format 1: { "data": [...] }
	if data, ok := result["data"].([]interface{}); ok {
		for i, item := range data {
			if m, ok := item.(map[string]interface{}); ok {
				f := parseGenericMatch(m, i)
				fixtures = append(fixtures, f)
			}
		}
	}

	// Format 2: { "events": [...] }
	if len(fixtures) == 0 {
		if events, ok := result["events"].([]interface{}); ok {
			for i, item := range events {
				if m, ok := item.(map[string]interface{}); ok {
					f := parseGenericMatch(m, i)
					fixtures = append(fixtures, f)
				}
			}
		}
	}

	// Format 3: direct array
	var arr []map[string]interface{}
	if err := json.Unmarshal(body, &arr); err == nil {
		for i, m := range arr {
			f := parseGenericMatch(m, i)
			fixtures = append(fixtures, f)
		}
	}

	if len(fixtures) > 0 {
		data, _ := json.Marshal(fixtures)
		s.cache.Set(cacheKey, data, 60*time.Second)
	}
	return fixtures, nil
}

func parseGenericMatch(m map[string]interface{}, idx int) Fixture {
	getString := func(keys ...string) string {
		for _, k := range keys {
			if v, ok := m[k].(string); ok && v != "" { return v }
		}
		return ""
	}
	getInt := func(keys ...string) *int {
		for _, k := range keys {
			switch v := m[k].(type) {
			case float64:
				i := int(v); return &i
			case string:
				if v != "" && v != "-" {
					var i int
					fmt.Sscanf(v, "%d", &i)
					return &i
				}
			}
		}
		return nil
	}

	return Fixture{
		ID:         fmt.Sprintf("ls_%d", idx),
		HomeTeam:   getString("home_name", "home", "homeTeam", "home_team", "strHomeTeam"),
		AwayTeam:   getString("away_name", "away", "awayTeam", "away_team", "strAwayTeam"),
		HomeScore:  getInt("home_score", "score_home", "homeScore", "goals_home"),
		AwayScore:  getInt("away_score", "score_away", "awayScore", "goals_away"),
		Status:     getString("status", "match_status", "event_status", "strStatus"),
		Date:       getString("date", "event_date", "dateEvent", "match_date"),
		Time:       getString("time", "event_time", "strTime"),
		LeagueName: getString("league", "league_name", "strLeague", "competition"),
		Country:    getString("country", "strCountry"),
	}
}

// GET /api/scores?date=YYYY-MM-DD
func (s *Server) handleScores(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" { date = time.Now().Format("2006-01-02") }

	// Primary: TheSportsDB (free, reliable)
	fixtures, err := s.fetchTSDB(date)
	if err != nil || len(fixtures) == 0 {
		// Fallback: Free Livescore API
		fixtures2, err2 := s.fetchLivescoreAPI(date)
		if err2 == nil && len(fixtures2) > 0 {
			fixtures = append(fixtures, fixtures2...)
		}
	}

	// Deduplicate
	seen := map[string]bool{}
	var unique []Fixture
	for _, f := range fixtures {
		key := strings.ToLower(f.HomeTeam + "_" + f.AwayTeam + "_" + f.Date)
		if !seen[key] {
			seen[key] = true
			unique = append(unique, f)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"date":     date,
		"count":    len(unique),
		"fixtures": unique,
	})
}

// GET /api/scores/live
func (s *Server) handleLiveScores(w http.ResponseWriter, r *http.Request) {
	date := time.Now().Format("2006-01-02")
	fixtures, _ := s.fetchTSDB(date)

	var live []Fixture
	for _, f := range fixtures {
		u := strings.ToUpper(f.Status)
		if strings.Contains(u, "PLAY") || strings.Contains(u, "LIVE") ||
			u == "HT" || u == "IN_PLAY" || strings.Contains(u, "1H") || strings.Contains(u, "2H") {
			live = append(live, f)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"date":     date,
		"count":    len(live),
		"fixtures": live,
	})
}

// GET /api/scores/search?q=arsenal
func (s *Server) handleSearchScores(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(r.URL.Query().Get("q"))
	if q == "" { jsonErr(w, "q required", 400); return }

	date := time.Now().Format("2006-01-02")
	fixtures, _ := s.fetchTSDB(date)

	var results []Fixture
	for _, f := range fixtures {
		if strings.Contains(strings.ToLower(f.HomeTeam), q) ||
			strings.Contains(strings.ToLower(f.AwayTeam), q) {
			results = append(results, f)
		}
	}

	jsonOK(w, map[string]interface{}{"results": results})
}

// ─── AI — Google Gemini ───────────────────────────────────────────
type AIRequest struct {
	Prompt  string   `json:"prompt"`
	Markets []string `json:"markets,omitempty"`
	Date    string   `json:"date,omitempty"`
}

func (s *Server) handleAI(w http.ResponseWriter, r *http.Request) {
	var req AIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "Invalid request", 400); return
	}
	if req.Prompt == "" { jsonErr(w, "prompt required", 400); return }

	payload := map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{
				{"text": fmt.Sprintf(`You are Dior Sports Padi AI — elite football analyst and betting intelligence engine.
You have deep knowledge of football matches, team form, injuries, and betting markets.
Be specific with real team names, player names, recent results, and statistics.
Format with clear emoji-headed sections. Be confident, punchy, and actionable.
Today: %s.

%s`, time.Now().Format("Monday 2 January 2006"), req.Prompt)},
			}},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     0.7,
			"maxOutputTokens": 1000,
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=%s", geminiKey)

	apiReq, _ := http.NewRequest("POST", url, strings.NewReader(string(payloadBytes)))
	apiReq.Header.Set("Content-Type", "application/json")

	resp, err := s.httpClient.Do(apiReq)
	if err != nil { jsonErr(w, "AI error: "+err.Error(), 502); return }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct{ Text string `json:"text"` } `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		Error *struct{ Message string `json:"message"` } `json:"error"`
	}
	json.Unmarshal(body, &geminiResp)

	if geminiResp.Error != nil {
		jsonErr(w, "Gemini: "+geminiResp.Error.Message, 502); return
	}

	var result string
	if len(geminiResp.Candidates) > 0 && len(geminiResp.Candidates[0].Content.Parts) > 0 {
		result = geminiResp.Candidates[0].Content.Parts[0].Text
	} else {
		result = "No response generated."
	}

	jsonOK(w, map[string]string{"result": result})
}

// ─── TICKETS ──────────────────────────────────────────────────────
func (s *Server) handleSaveTicket(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("uid").(string)
	var ticket SavedTicket
	json.NewDecoder(r.Body).Decode(&ticket)
	ticket.ID = primitive.NewObjectID()
	ticket.UserID = uid
	ticket.CreatedAt = time.Now()
	s.db.Collection("tickets").InsertOne(r.Context(), ticket)
	jsonOK(w, ticket)
}

func (s *Server) handleGetTickets(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("uid").(string)
	cursor, err := s.db.Collection("tickets").Find(
		r.Context(),
		bson.M{"userId": uid},
		options.Find().SetSort(bson.M{"createdAt": -1}).SetLimit(20),
	)
	if err != nil { jsonErr(w, err.Error(), 500); return }
	var tickets []SavedTicket
	cursor.All(r.Context(), &tickets)
	if tickets == nil { tickets = []SavedTicket{} }
	jsonOK(w, tickets)
}

// ─── MAIN ─────────────────────────────────────────────────────────
func main() {
	initConfig()
	ctx := context.Background()

	mongoClient, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil { log.Fatalf("MongoDB: %v", err) }
	defer mongoClient.Disconnect(ctx)
	if err = mongoClient.Ping(ctx, nil); err != nil { log.Fatalf("MongoDB ping: %v", err) }
	log.Println("✅ MongoDB connected")
	db := mongoClient.Database("dior_sports_padi")

	opt := option.WithCredentialsFile(firebaseCredsPath)
	app, err := firebase.NewApp(ctx, nil, opt)
	if err != nil { log.Fatalf("Firebase: %v", err) }
	fireAuth, err := app.Auth(ctx)
	if err != nil { log.Fatalf("Firebase auth: %v", err) }
	log.Println("✅ Firebase connected")

	srv := NewServer(db, fireAuth)
	r := mux.NewRouter()
	api := r.PathPrefix("/api").Subrouter()

	api.HandleFunc("/health",        srv.handleHealth).Methods("GET")
	api.HandleFunc("/scores/live",   srv.handleLiveScores).Methods("GET")
	api.HandleFunc("/scores/search", srv.handleSearchScores).Methods("GET")
	api.HandleFunc("/scores",        srv.handleScores).Methods("GET")
	api.HandleFunc("/ai",            srv.handleAI).Methods("POST")
	api.HandleFunc("/auth/profile",  srv.authMiddleware(srv.handleRegisterProfile)).Methods("POST")
	api.HandleFunc("/auth/me",       srv.authMiddleware(srv.handleGetProfile)).Methods("GET")
	api.HandleFunc("/tickets",       srv.authMiddleware(srv.handleSaveTicket)).Methods("POST")
	api.HandleFunc("/tickets",       srv.authMiddleware(srv.handleGetTickets)).Methods("GET")

	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})

	log.Printf("🚀 Dior Sports Padi running on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, c.Handler(r)))
}

