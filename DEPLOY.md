# ═══════════════════════════════════════════════════════════
#  THE BOARD ROOM — DEPLOYMENT GUIDE (Debian VPS)
#  Fits your 1 CPU / 2GB RAM setup
# ═══════════════════════════════════════════════════════════

## 1. UPLOAD PROJECT ──────────────────────────────────────────

scp -r ./chess3d user@153.75.235.149:/var/www/chess3d

# On VPS:
cd /var/www/chess3d
npm install --production


## 2. SYSTEMD SERVICE ─────────────────────────────────────────
# Create: /etc/systemd/system/chess3d.service

[Unit]
Description=Chess3D Socket.IO Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/chess3d
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001

[Install]
WantedBy=multi-user.target

# Enable & start:
# systemctl daemon-reload
# systemctl enable chess3d
# systemctl start chess3d
# systemctl status chess3d


## 3. APACHE REVERSE PROXY ────────────────────────────────────
# Create: /etc/apache2/sites-available/chess3d.conf
# (Assuming chess.lyhor.space or similar)

<VirtualHost *:80>
    ServerName chess.lyhor.space
    Redirect permanent / https://chess.lyhor.space/
</VirtualHost>

<VirtualHost *:443>
    ServerName chess.lyhor.space

    SSLEngine on
    SSLCertificateFile    /etc/ssl/certs/lyhor.space.pem
    SSLCertificateKeyFile /etc/ssl/private/lyhor.space.key

    # Proxy HTTP
    ProxyPreserveHost On
    ProxyPass        / http://localhost:3001/
    ProxyPassReverse / http://localhost:3001/

    # WebSocket support (Socket.IO needs this!)
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://localhost:3001/$1 [P,L]

    ErrorLog  ${APACHE_LOG_DIR}/chess3d-error.log
    CustomLog ${APACHE_LOG_DIR}/chess3d-access.log combined
</VirtualHost>

# Enable site:
# a2enmod proxy proxy_http proxy_wstunnel rewrite ssl
# a2ensite chess3d
# systemctl reload apache2


## 4. CLOUDFLARE ───────────────────────────────────────────────
# Add DNS A record: chess.lyhor.space → 153.75.235.149
# Proxy: ON (orange cloud)
# SSL/TLS: Full (Strict)
# Under Network: WebSockets → ENABLED  ← important for Socket.IO


## 5. UFW FIREWALL ────────────────────────────────────────────
# Port 3001 stays internal — Apache proxies it
# ufw allow 80/tcp
# ufw allow 443/tcp
# No need to expose 3001


## 6. MEMORY FOOTPRINT ESTIMATE ───────────────────────────────
# Node.js idle:          ~45 MB
# Per active room:       ~1-2 MB (just board state + 2 sockets)
# Three.js (client):     runs in BROWSER, 0 server RAM
# Total server impact:   ~60-80 MB for 10 concurrent games
# Your available 1.3GB:  MORE than enough ✓


## 7. QUICK HEALTH CHECK ──────────────────────────────────────
# curl http://localhost:3001
# journalctl -u chess3d -f

# ───────────────────────────────────────────────────────────
#  UPDATE NOTES (v4)
# ───────────────────────────────────────────────────────────
# NEW: public/assets/pieces/*.glb  (MIT chess models) — must be uploaded.
# NEW: GLTFLoader is pulled from jsDelivr CDN (needs outbound https; Cloudflare proxy is fine).
#
# Cache busting:
#   index.html links assets as style.css?v=4 and game.js?v=4 — bump on each deploy.
#   The Node static server now sends Cache-Control: no-cache for *.html.
#   After deploying, in Cloudflare: Caching → Purge Everything (once), then hard refresh.
#
# Redeploy:
#   scp -r public server package.json user@153.75.235.149:/var/www/chess3d/
#   ssh ... 'cd /var/www/chess3d && sudo systemctl restart chess3d'
#   # Verify the model files are served:
#   curl -sI https://chess.lyhor.space/assets/pieces/king.glb | head -1
