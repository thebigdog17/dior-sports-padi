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

type Fixture struct {
	ID         string  `json:"id"`
	HomeTeam   string  `json:"home_name"`
	AwayTeam   string  `json:"away_name"`
	HomeScore  *int    `json:"home_score"`
	AwayScore  *int    `json:"away_score"`
	Status     string  `json:"status"`
	Minute     string  `json:"minute"`
	Date       string  `json:"date"`
	Time       string  `json:"time"`
	LeagueName string  `json:"league_name"`
	LeagueLogo string  `json:"league_logo"`
	Country    string  `json:"country"`
	HomeLogo   string  `json:"home_logo"`
	AwayLogo   string  `json:"away_logo"`
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

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	jsonOK(w, map[string]interface{}{"status": "ok", "timestamp": time.Now().UTC()})
}

// ─── AUTH ─────────────────────────────────────────────────────────
func (s *Server) handleRegisterProfile(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("uid").(string)
	var body struct {
		Name  string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	fireUser, err := s.fireAuth.GetUser(r.Context(), uid)
	if err != nil { jsonErr(w, "Firebase user not found", 400); return }
	col := s.db.Collection("users")
	filter := bson.M{"firebaseUid": uid}
	update := bson.M{
		"$set": bson.M{"firebaseUid": uid, "email": fireUser.Email, "name": body.Name, "updatedAt": time.Now()},
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
	if err := s.db.Collection("users").FindOne(r.Context(), bson.M{"firebaseUid": uid}).Decode(&user); err != nil {
		jsonErr(w, "User not found", 404); return
	}
	jsonOK(w, user)
}

// ─── API-FOOTBALL: full global coverage ───────────────────────────
// Fetches ALL fixtures for a date using API-Football v3
// Uses the /fixtures endpoint with date parameter — covers 900+ leagues
func (s *Server) fetchAPIFootball(date string) ([]Fixture, error) {
	cacheKey := "apif:" + date
	if cached, ok := s.cache.Get(cacheKey); ok {
		var f []Fixture
		json.Unmarshal(cached, &f)
		return f, nil
	}

	// API-Football endpoint: all fixtures for a specific date
	url := fmt.Sprintf("https://api-football-v1.p.rapidapi.com/v3/fixtures?date=%s", date)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil { return nil, err }
	req.Header.Set("X-RapidAPI-Key", rapidAPIKey)
	req.Header.Set("X-RapidAPI-Host", "api-football-v1.p.rapidapi.com")

	resp, err := s.httpClient.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil { return nil, err }

	log.Printf("API-Football response for %s: status=%d, size=%d bytes", date, resp.StatusCode, len(body))

	// Parse API-Football v3 response format
	var apiResp struct {
		Response []struct {
			Fixture struct {
				ID     int    `json:"id"`
				Date   string `json:"date"`
				Status struct {
					Short   string `json:"short"`
					Long    string `json:"long"`
					Elapsed *int   `json:"elapsed"`
				} `json:"status"`
			} `json:"fixture"`
			League struct {
				Name    string `json:"name"`
				Country string `json:"country"`
				Logo    string `json:"logo"`
			} `json:"league"`
			Teams struct {
				Home struct {
					Name string `json:"name"`
					Logo string `json:"logo"`
				} `json:"home"`
				Away struct {
					Name string `json:"name"`
					Logo string `json:"logo"`
				} `json:"away"`
			} `json:"teams"`
			Goals struct {
				Home *int `json:"home"`
				Away *int `json:"away"`
			} `json:"goals"`
			Score struct {
				Halftime struct {
					Home *int `json:"home"`
					Away *int `json:"away"`
				} `json:"halftime"`
				Fulltime struct {
					Home *int `json:"home"`
					Away *int `json:"away"`
				} `json:"fulltime"`
			} `json:"score"`
		} `json:"response"`
		Errors interface{} `json:"errors"`
	}

	if err := json.Unmarshal(body, &apiResp); err != nil {
		log.Printf("Parse error: %v — body: %s", err, string(body[:min(200, len(body))]))
		return nil, err
	}

	log.Printf("API-Football returned %d fixtures for %s", len(apiResp.Response), date)

	var fixtures []Fixture
	for _, r := range apiResp.Response {
		// parse kickoff time
		koTime := ""
		if r.Fixture.Date != "" {
			if t, err := time.Parse(time.RFC3339, r.Fixture.Date); err == nil {
				koTime = t.Format("15:04")
			}
		}

		// elapsed minute
		minute := ""
		if r.Fixture.Status.Elapsed != nil {
			minute = fmt.Sprintf("%d'", *r.Fixture.Status.Elapsed)
		}

		fixtures = append(fixtures, Fixture{
			ID:         fmt.Sprintf("%d", r.Fixture.ID),
			HomeTeam:   r.Teams.Home.Name,
			AwayTeam:   r.Teams.Away.Name,
			HomeScore:  r.Goals.Home,
			AwayScore:  r.Goals.Away,
			Status:     r.Fixture.Status.Short,
			Minute:     minute,
			Date:       date,
			Time:       koTime,
			LeagueName: r.League.Name,
			LeagueLogo: r.League.Logo,
			Country:    r.League.Country,
			HomeLogo:   r.Teams.Home.Logo,
			AwayLogo:   r.Teams.Away.Logo,
		})
	}

	if len(fixtures) > 0 {
		data, _ := json.Marshal(fixtures)
		// cache 60s for today (live), 10min for past/future
		ttl := 60 * time.Second
		if date != time.Now().Format("2006-01-02") {
			ttl = 10 * time.Minute
		}
		s.cache.Set(cacheKey, data, ttl)
	}
	return fixtures, nil
}

// TheSportsDB as fallback (free, no key)
func (s *Server) fetchTSDB(date string) ([]Fixture, error) {
	url := fmt.Sprintf("https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=%s&s=Soccer", date)
	resp, err := s.httpClient.Get(url)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var tsdbResp struct {
		Events []struct {
			IDEvent      string `json:"idEvent"`
			StrHomeTeam  string `json:"strHomeTeam"`
			StrAwayTeam  string `json:"strAwayTeam"`
			IntHomeScore string `json:"intHomeScore"`
			IntAwayScore string `json:"intAwayScore"`
			StrStatus    string `json:"strStatus"`
			DateEvent    string `json:"dateEvent"`
			StrTime      string `json:"strTime"`
			StrLeague    string `json:"strLeague"`
			StrLeagueBadge string `json:"strLeagueBadge"`
			StrCountry   string `json:"strCountry"`
		} `json:"events"`
	}
	if err := json.Unmarshal(body, &tsdbResp); err != nil { return nil, err }

	var fixtures []Fixture
	for _, e := range tsdbResp.Events {
		status := "NS"
		switch strings.ToLower(e.StrStatus) {
		case "match finished", "ft": status = "FT"
		case "in progress": status = "IN_PLAY"
		case "postponed": status = "PST"
		}
		var hs, as_ *int
		if e.IntHomeScore != "" && e.IntHomeScore != "null" {
			v := 0; fmt.Sscanf(e.IntHomeScore, "%d", &v); hs = &v
		}
		if e.IntAwayScore != "" && e.IntAwayScore != "null" {
			v := 0; fmt.Sscanf(e.IntAwayScore, "%d", &v); as_ = &v
		}
		fixtures = append(fixtures, Fixture{
			ID:         "tsdb_" + e.IDEvent,
			HomeTeam:   e.StrHomeTeam,
			AwayTeam:   e.StrAwayTeam,
			HomeScore:  hs,
			AwayScore:  as_,
			Status:     status,
			Date:       e.DateEvent,
			Time:       e.StrTime,
			LeagueName: e.StrLeague,
			LeagueLogo: e.StrLeagueBadge,
			Country:    e.StrCountry,
		})
	}
	return fixtures, nil
}

func min(a, b int) int {
	if a < b { return a }
	return b
}

// GET /api/scores?date=YYYY-MM-DD
func (s *Server) handleScores(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" { date = time.Now().Format("2006-01-02") }

	// Primary: API-Football (900+ leagues)
	fixtures, err := s.fetchAPIFootball(date)
	if err != nil {
		log.Printf("API-Football error: %v, falling back to TSDB", err)
	}

	// Fallback: TheSportsDB if API-Football fails or returns nothing
	if len(fixtures) == 0 {
		log.Printf("API-Football returned 0 fixtures, trying TSDB fallback")
		tsdbFixtures, tsdbErr := s.fetchTSDB(date)
		if tsdbErr == nil && len(tsdbFixtures) > 0 {
			fixtures = tsdbFixtures
		}
	}

	// Sort by status: live first, then NS, then FT
	var live, ns, ft []Fixture
	for _, f := range fixtures {
		u := strings.ToUpper(f.Status)
		if u == "1H" || u == "2H" || u == "HT" || u == "ET" || u == "P" || u == "IN_PLAY" {
			live = append(live, f)
		} else if u == "FT" || u == "AET" || u == "PEN" {
			ft = append(ft, f)
		} else {
			ns = append(ns, f)
		}
	}
	sorted := append(append(live, ns...), ft...)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"date":     date,
		"count":    len(sorted),
		"fixtures": sorted,
	})
}

// GET /api/scores/live — currently live matches only
func (s *Server) handleLiveScores(w http.ResponseWriter, r *http.Request) {
	date := time.Now().Format("2006-01-02")
	fixtures, err := s.fetchAPIFootball(date)
	if err != nil || len(fixtures) == 0 {
		fixtures, _ = s.fetchTSDB(date)
	}

	var live []Fixture
	for _, f := range fixtures {
		u := strings.ToUpper(f.Status)
		if u == "1H" || u == "2H" || u == "HT" || u == "ET" || u == "P" || u == "IN_PLAY" {
			live = append(live, f)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"date": date, "count": len(live), "fixtures": live,
	})
}

// GET /api/scores/search?q=arsenal
func (s *Server) handleSearchScores(w http.ResponseWriter, r *http.Request) {
	q := strings.ToLower(r.URL.Query().Get("q"))
	if q == "" { jsonErr(w, "q required", 400); return }
	date := time.Now().Format("2006-01-02")
	fixtures, _ := s.fetchAPIFootball(date)
	var results []Fixture
	for _, f := range fixtures {
		if strings.Contains(strings.ToLower(f.HomeTeam), q) ||
			strings.Contains(strings.ToLower(f.AwayTeam), q) {
			results = append(results, f)
		}
	}
	jsonOK(w, map[string]interface{}{"results": results})
}

// ─── AI: Google Gemini ────────────────────────────────────────────
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
			{"parts": []map[string]string{{"text": fmt.Sprintf(
				`You are Dior Sports Padi AI — elite football analyst and betting engine.
You have deep knowledge of football, team form, injuries, and betting markets.
Use real team names, real statistics, real results.
Format with emoji headers. Be confident and actionable.
Today: %s.

%s`, time.Now().Format("Monday 2 January 2006"), req.Prompt)}}},
		},
		"generationConfig": map[string]interface{}{
			"temperature": 0.7, "maxOutputTokens": 1000,
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
	if geminiResp.Error != nil { jsonErr(w, "Gemini: "+geminiResp.Error.Message, 502); return }

	result := "No response generated."
	if len(geminiResp.Candidates) > 0 && len(geminiResp.Candidates[0].Content.Parts) > 0 {
		result = geminiResp.Candidates[0].Content.Parts[0].Text
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
	cursor, err := s.db.Collection("tickets").Find(r.Context(),
		bson.M{"userId": uid},
		options.Find().SetSort(bson.M{"createdAt": -1}).SetLimit(20))
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

	opt := option.WithCredentialsFile(firebaseCredsPath)
	app, err := firebase.NewApp(ctx, nil, opt)
	if err != nil { log.Fatalf("Firebase: %v", err) }
	fireAuth, err := app.Auth(ctx)
	if err != nil { log.Fatalf("Firebase auth: %v", err) }
	log.Println("✅ Firebase connected")

	srv := NewServer(mongoClient.Database("dior_sports_padi"), fireAuth)
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

	log.Printf("🚀 Dior Sports Padi backend on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, c.Handler(r)))
}

