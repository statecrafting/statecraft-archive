{
  "id": "",
  "lang": "typescript",
  "build": {
    "docker": {
      "bundle_source": true
    }
  },
  "global_cors": {
    "debug": false,
    "allow_headers": ["Authorization", "Content-Type", "X-CSRF-Token"],
    "expose_headers": ["X-CSRF-Token"],
    "allow_origins_with_credentials": [
      "http://localhost:5173",
      "http://localhost:5174"
    ]
  }
}
