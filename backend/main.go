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
	"github.com/rs/cors"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/primitive"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
	"google.golang.org/api/option"
)

// ─── CONFIG ───────────────────────────────────────────────────────
var (
	mongoURI          = mustEnv("MONGO_URI")
	apiFootballKey    = mustEnv("API_FOOTBALL_KEY")
	anthropicKey      = mustEnv("ANTHROPIC_API_KEY")
	firebaseCredsPath = getEnv("FIREBASE_CREDS", "./firebase-credentials.json")
	port              = getEnv("PORT", "8080")
)

func mustEnv(k string) string {
	v := os.Getenv(k)
	if v == "" {
		log.Fatalf("Missing required env var: %s", k)
	}
	return v
}
func getEnv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
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
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	FirebaseUID string           `bson:"firebaseUid"   json:"firebaseUid"`
	Phone     string             `bson:"phone"         json:"phone"`
	Name      string             `bson:"name"          json:"name"`
	CreatedAt time.Time          `bson:"createdAt"     json:"createdAt"`
}

type SavedTicket struct {
	ID        primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	UserID    string             `bson:"userId"        json:"userId"`
	Date      string             `bson:"date"          json:"date"`
	Markets   []string           `bson:"markets"       json:"markets"`
	Content   string             `bson:"content"       json:"content"`
	CreatedAt time.Time          `bson:"createdAt"     json:"createdAt"`
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
		db:         db,
		cache:      NewCache(),
		fireAuth:   fa,
		httpClient: &http.Client{Timeout: 12 * time.Second},
	}
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────
func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			jsonErr(w, "Missing authorization token", 401); return
		}
		idToken := strings.TrimPrefix(header, "Bearer ")
		token, err := s.fireAuth.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			jsonErr(w, "Invalid token: "+err.Error(), 401); return
		}
		// inject uid into context
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
	jsonOK(w, map[string]interface{}{
		"status":    "ok",
		"service":   "dior-sports-padi",
		"timestamp": time.Now().UTC(),
	})
}

// ─── AUTH: register/update user profile after Firebase sign-in ───
func (s *Server) handleRegisterProfile(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("uid").(string)
	var body struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	col := s.db.Collection("users")
	ctx := r.Context()

	// get firebase user for phone
	fireUser, err := s.fireAuth.GetUser(ctx, uid)
	if err != nil {
		jsonErr(w, "Firebase user not found", 400); return
	}

	// upsert
	filter := bson.M{"firebaseUid": uid}
	update := bson.M{"$set": bson.M{
		"firebaseUid": uid,
		"phone":       fireUser.PhoneNumber,
		"name":        body.Name,
		"updatedAt":   time.Now(),
	}, "$setOnInsert": bson.M{"createdAt": time.Now()}}
	opts := options.Update().SetUpsert(true)
	col.UpdateOne(ctx, filter, update, opts)

	var user User
	col.FindOne(ctx, filter).Decode(&user)
	jsonOK(w, user)
}

func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("uid").(string)
	var user User
	err := s.db.Collection("users").FindOne(r.Context(), bson.M{"firebaseUid": uid}).Decode(&user)
	if err != nil {
		jsonErr(w, "User not found", 404); return
	}
	jsonOK(w, user)
}

// ─── LIVE SCORES — API-Football ───────────────────────────────────
// GET /api/scores?date=2025-03-15&league=39
// league IDs: 39=PL, 140=LaLiga, 78=Bundesliga, 135=SerieA, 61=Ligue1
//             2=UCL, 3=UEL, 88=Eredivisie, 94=PrimeiraLiga, 253=MLS
//             207=AFCON, 29=Nigeria NPFL ...

var popularLeagues = []string{
	"39",  // Premier League
	"140", // La Liga
	"78",  // Bundesliga
	"135", // Serie A
	"61",  // Ligue 1
	"2",   // Champions League
	"3",   // Europa League
	"88",  // Eredivisie
	"94",  // Primeira Liga
	"253", // MLS
	"207", // AFCON
	"233", // Nigeria NPFL
	"29",  // CAF Champions League
}

func (s *Server) fetchAPIFootball(endpoint string) ([]byte, error) {
	cacheKey := "apif:" + endpoint
	if cached, ok := s.cache.Get(cacheKey); ok {
		return cached, nil
	}
	req, _ := http.NewRequest("GET", "https://api-football-v1.p.rapidapi.com/v3/"+endpoint, nil)
	req.Header.Set("X-RapidAPI-Key", apiFootballKey)
	req.Header.Set("X-RapidAPI-Host", "api-football-v1.p.rapidapi.com")

	resp, err := s.httpClient.Do(req)
	if err != nil { return nil, err }
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil { return nil, err }

	// cache: 60s for live, 5min for finished
	s.cache.Set(cacheKey, body, 60*time.Second)
	return body, nil
}

// GET /api/scores?date=YYYY-MM-DD
func (s *Server) handleScores(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	// fetch all popular leagues in parallel
	type result struct {
		data []byte
		err  error
	}
	ch := make(chan result, len(popularLeagues))
	for _, lid := range popularLeagues {
		go func(lid string) {
			data, err := s.fetchAPIFootball(fmt.Sprintf("fixtures?date=%s&league=%s&season=2024", date, lid))
			ch <- result{data, err}
		}(lid)
	}

	var allFixtures []json.RawMessage
	for range popularLeagues {
		res := <-ch
		if res.err != nil { continue }
		var parsed struct {
			Response []json.RawMessage `json:"response"`
		}
		if err := json.Unmarshal(res.data, &parsed); err != nil { continue }
		allFixtures = append(allFixtures, parsed.Response...)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"date":     date,
		"count":    len(allFixtures),
		"fixtures": allFixtures,
	})
}

// GET /api/scores/live
func (s *Server) handleLiveScores(w http.ResponseWriter, r *http.Request) {
	data, err := s.fetchAPIFootball("fixtures?live=all")
	if err != nil { jsonErr(w, err.Error(), 502); return }
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// GET /api/scores/fixture/:id — single fixture details
func (s *Server) handleFixture(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	data, err := s.fetchAPIFootball("fixtures?id=" + id)
	if err != nil { jsonErr(w, err.Error(), 502); return }
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// GET /api/standings?league=39&season=2024
func (s *Server) handleStandings(w http.ResponseWriter, r *http.Request) {
	league := r.URL.Query().Get("league")
	season := r.URL.Query().Get("season")
	if season == "" { season = "2024" }
	data, err := s.fetchAPIFootball(fmt.Sprintf("standings?league=%s&season=%s", league, season))
	if err != nil { jsonErr(w, err.Error(), 502); return }
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// ─── AI ANALYSIS — Claude with web search ────────────────────────
type AIRequest struct {
	Prompt  string   `json:"prompt"`
	Markets []string `json:"markets,omitempty"`
	Date    string   `json:"date,omitempty"`
}

func (s *Server) handleAI(w http.ResponseWriter, r *http.Request) {
	var req AIRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonErr(w, "Invalid request body", 400); return
	}
	if req.Prompt == "" {
		jsonErr(w, "prompt is required", 400); return
	}

	// Call Claude API with web search
	payload := map[string]interface{}{
		"model":      "claude-sonnet-4-20250514",
		"max_tokens": 1000,
		"system": fmt.Sprintf(`You are Dior Sports Padi AI — elite football analyst and betting intelligence engine.
ALWAYS use web_search tool first to get CURRENT real-time data before answering.
Search for: live form, confirmed injuries, suspensions, h2h, odds, team news.
Use real player names, real recent results, real statistics.
Format with emoji section headers. Be confident, specific, and actionable.
Today: %s.`, time.Now().Format("Monday 2 January 2006")),
		"tools": []map[string]string{
			{"type": "web_search_20250305", "name": "web_search"},
		},
		"messages": []map[string]interface{}{
			{"role": "user", "content": req.Prompt},
		},
	}

	payloadBytes, _ := json.Marshal(payload)
	apiReq, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages",
		strings.NewReader(string(payloadBytes)))
	apiReq.Header.Set("Content-Type", "application/json")
	apiReq.Header.Set("x-api-key", anthropicKey)
	apiReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := s.httpClient.Do(apiReq)
	if err != nil { jsonErr(w, "AI service error: "+err.Error(), 502); return }
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	// extract text blocks
	var claude struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Error *struct{ Message string `json:"message"` } `json:"error"`
	}
	json.Unmarshal(body, &claude)
	if claude.Error != nil {
		jsonErr(w, claude.Error.Message, 502); return
	}

	var texts []string
	for _, c := range claude.Content {
		if c.Type == "text" && c.Text != "" {
			texts = append(texts, c.Text)
		}
	}
	jsonOK(w, map[string]string{"result": strings.Join(texts, "\n\n")})
}

// ─── TICKETS: save / list ─────────────────────────────────────────
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
	ctx := context.Background()

	// MongoDB
	mongoClient, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil { log.Fatalf("MongoDB connect: %v", err) }
	defer mongoClient.Disconnect(ctx)
	if err = mongoClient.Ping(ctx, nil); err != nil {
		log.Fatalf("MongoDB ping: %v", err)
	}
	log.Println("✅ MongoDB connected")
	db := mongoClient.Database("dior_sports_padi")

	// Firebase
	opt := option.WithCredentialsFile(firebaseCredsPath)
	app, err := firebase.NewApp(ctx, nil, opt)
	if err != nil { log.Fatalf("Firebase init: %v", err) }
	fireAuth, err := app.Auth(ctx)
	if err != nil { log.Fatalf("Firebase auth: %v", err) }
	log.Println("✅ Firebase connected")

	srv := NewServer(db, fireAuth)

	r := mux.NewRouter()
	api := r.PathPrefix("/api").Subrouter()

	// Public
	api.HandleFunc("/health",        srv.handleHealth).Methods("GET")
	api.HandleFunc("/scores",        srv.handleScores).Methods("GET")
	api.HandleFunc("/scores/live",   srv.handleLiveScores).Methods("GET")
	api.HandleFunc("/scores/fixture/{id}", srv.handleFixture).Methods("GET")
	api.HandleFunc("/standings",     srv.handleStandings).Methods("GET")
	api.HandleFunc("/ai",            srv.handleAI).Methods("POST")

	// Protected (require Firebase token)
	api.HandleFunc("/auth/profile",  srv.authMiddleware(srv.handleRegisterProfile)).Methods("POST")
	api.HandleFunc("/auth/me",       srv.authMiddleware(srv.handleGetProfile)).Methods("GET")
	api.HandleFunc("/tickets",       srv.authMiddleware(srv.handleSaveTicket)).Methods("POST")
	api.HandleFunc("/tickets",       srv.authMiddleware(srv.handleGetTickets)).Methods("GET")

	// CORS
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET","POST","PUT","DELETE","OPTIONS"},
		AllowedHeaders:   []string{"Authorization","Content-Type"},
		AllowCredentials: true,
	})

	log.Printf("🚀 Dior Sports Padi backend running on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, c.Handler(r)))
}
