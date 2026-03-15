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
	mongoURI = mustEnv("MONGO_URI")
	rapidAPIKey = mustEnv("RAPIDAPI_KEY")
	geminiKey = mustEnv("GEMINI_API_KEY")
	firebaseCredsPath = getEnv("FIREBASE_CREDS", "./firebase-credentials.json")
	port = getEnv("PORT", "8080")
}

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
	c.mu.RLock()
	defer c.mu.RUnlock()
	it, ok := c.items[k]
	if !ok || time.Now().After(it.expiresAt) {
		return nil, false
	}
	return it.data, true
}
func (c *Cache) Set(k string, d []byte, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.items[k] = cacheItem{data: d, expiresAt: time.Now().Add(ttl)}
}

// ─── MODELS ───────────────────────────────────────────────────────
type User struct {
	ID          primitive.ObjectID `bson:"_id,omitempty" json:"id"`
	FirebaseUID string             `bson:"firebaseUid"   json:"firebaseUid"`
	Phone       string             `bson:"phone"         json:"phone"`
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
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────
func (s *Server) authMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			jsonErr(w, "Missing authorization token", 401)
			return
		}
		idToken := strings.TrimPrefix(header, "Bearer ")
		token, err := s.fireAuth.VerifyIDToken(r.Context(), idToken)
		if err != nil {
			jsonErr(w, "Invalid token: "+err.Error(), 401)
			return
		}
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

// ─── AUTH ─────────────────────────────────────────────────────────
func (s *Server) handleRegisterProfile(w http.ResponseWriter, r *http.Request) {
	uid := r.Context().Value("uid").(string)
	var body struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	fireUser, err := s.fireAuth.GetUser(r.Context(), uid)
	if err != nil {
		jsonErr(w, "Firebase user not found", 400)
		return
	}

	col := s.db.Collection("users")
	filter := bson.M{"firebaseUid": uid}
	update := bson.M{
		"$set": bson.M{
			"firebaseUid": uid,
			"phone":       fireUser.PhoneNumber,
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
	if err != nil {
		jsonErr(w, "User not found", 404)
		return
	}
	jsonOK(w, user)
}

// ─── LIVE SCORES — Free Livescore API ─────────────────────────────
func (s *Server) fetchLivescore(endpoint string) ([]byte, error) {
	cacheKey := "ls:" + endpoint
	if cached, ok := s.cache.Get(cacheKey); ok {
		return cached, nil
	}

	url := "https://free-livescore-api.p.rapidapi.com/" + endpoint
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-rapidapi-key", rapidAPIKey)
	req.Header.Set("x-rapidapi-host", "free-livescore-api.p.rapidapi.com")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	s.cache.Set(cacheKey, body, 60*time.Second)
	return body, nil
}

// GET /api/scores/live — all live matches
func (s *Server) handleLiveScores(w http.ResponseWriter, r *http.Request) {
	data, err := s.fetchLivescore("livescore-get?sportname=soccer")
	if err != nil {
		jsonErr(w, "Score service error: "+err.Error(), 502)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// GET /api/scores?date=YYYY-MM-DD
func (s *Server) handleScoresByDate(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	// fetch live + search by date
	ch := make(chan []byte, 2)
	go func() {
		data, err := s.fetchLivescore("livescore-get?sportname=soccer")
		if err != nil {
			ch <- nil
			return
		}
		ch <- data
	}()

	go func() {
		data, err := s.fetchLivescore(fmt.Sprintf("livescore-get-search?sportname=soccer&search=%s", date))
		if err != nil {
			ch <- nil
			return
		}
		ch <- data
	}()

	var results []json.RawMessage
	for i := 0; i < 2; i++ {
		data := <-ch
		if data == nil {
			continue
		}
		var parsed struct {
			Data []json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal(data, &parsed); err == nil {
			results = append(results, parsed.Data...)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"date":     date,
		"count":    len(results),
		"fixtures": results,
	})
}

// GET /api/scores/search?q=arsenal
func (s *Server) handleSearchScores(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query().Get("q")
	if q == "" {
		jsonErr(w, "q parameter required", 400)
		return
	}
	data, err := s.fetchLivescore("livescore-get-search?sportname=soccer&search=" + q)
	if err != nil {
		jsonErr(w, err.Error(), 502)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
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
		jsonErr(w, "Invalid request body", 400)
		return
	}
	if req.Prompt == "" {
		jsonErr(w, "prompt is required", 400)
		return
	}

	// Build Gemini request
	payload := map[string]interface{}{
		"contents": []map[string]interface{}{
			{
				"parts": []map[string]string{
					{
						"text": fmt.Sprintf(`You are Dior Sports Padi AI — elite football analyst and betting intelligence engine.
You have deep knowledge of football matches, team form, injuries, and betting markets.
Be specific with team names, player names, recent results, and statistics.
Format your responses with clear emoji-headed sections. Be confident, punchy, and actionable.
Today: %s.

%s`, time.Now().Format("Monday 2 January 2006"), req.Prompt),
					},
				},
			},
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
	if err != nil {
		jsonErr(w, "AI service error: "+err.Error(), 502)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	// Parse Gemini response
	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}

	json.Unmarshal(body, &geminiResp)

	if geminiResp.Error != nil {
		jsonErr(w, "Gemini error: "+geminiResp.Error.Message, 502)
		return
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
	if err != nil {
		jsonErr(w, err.Error(), 500)
		return
	}
	var tickets []SavedTicket
	cursor.All(r.Context(), &tickets)
	if tickets == nil {
		tickets = []SavedTicket{}
	}
	jsonOK(w, tickets)
}

// ─── MAIN ─────────────────────────────────────────────────────────
func main() {
	initConfig()
	ctx := context.Background()

	// MongoDB
	mongoClient, err := mongo.Connect(ctx, options.Client().ApplyURI(mongoURI))
	if err != nil {
		log.Fatalf("MongoDB connect error: %v", err)
	}
	defer mongoClient.Disconnect(ctx)

	if err = mongoClient.Ping(ctx, nil); err != nil {
		log.Fatalf("MongoDB ping failed: %v", err)
	}
	log.Println("✅ MongoDB connected")
	db := mongoClient.Database("dior_sports_padi")

	// Firebase
	opt := option.WithCredentialsFile(firebaseCredsPath)
	app, err := firebase.NewApp(ctx, nil, opt)
	if err != nil {
		log.Fatalf("Firebase init error: %v", err)
	}
	fireAuth, err := app.Auth(ctx)
	if err != nil {
		log.Fatalf("Firebase auth error: %v", err)
	}
	log.Println("✅ Firebase connected")

	srv := NewServer(db, fireAuth)
	r := mux.NewRouter()
	api := r.PathPrefix("/api").Subrouter()

	// Public routes
	api.HandleFunc("/health",         srv.handleHealth).Methods("GET")
	api.HandleFunc("/scores/live",    srv.handleLiveScores).Methods("GET")
	api.HandleFunc("/scores",         srv.handleScoresByDate).Methods("GET")
	api.HandleFunc("/scores/search",  srv.handleSearchScores).Methods("GET")
	api.HandleFunc("/ai",             srv.handleAI).Methods("POST")

	// Protected routes
	api.HandleFunc("/auth/profile",   srv.authMiddleware(srv.handleRegisterProfile)).Methods("POST")
	api.HandleFunc("/auth/me",        srv.authMiddleware(srv.handleGetProfile)).Methods("GET")
	api.HandleFunc("/tickets",        srv.authMiddleware(srv.handleSaveTicket)).Methods("POST")
	api.HandleFunc("/tickets",        srv.authMiddleware(srv.handleGetTickets)).Methods("GET")

	// CORS
	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	})

	log.Printf("🚀 Dior Sports Padi running on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, c.Handler(r)))
}
