# Deployment Guide — AI Trading Analyzer (Oracle Cloud + Tailscale, 24/7)

**Goal:** Run the app on a free Oracle Cloud VM so it's accessible from anywhere
(phone, laptop) — **only you**, encrypted via Tailscale, with **zero data loss**.

---

## 0. Prerequisites
- Oracle Cloud free account (https://www.oracle.com/cloud/free/)
- Tailscale account (https://tailscale.com/ — free tier, personal use)
- Your local backup at `C:/Users/Aris/Documents/trading-analyzer-BACKUP-20260815/`

---

## 1. Create Oracle Cloud VM (Always-Free)
1. Sign in → **Create a VM instance**
2. Image: **Ubuntu 22.04 LTS**
3. Shape: **VM.Standard.A1.Flex** (ARM, 4 OCPU / 24GB RAM — free)
4. **IMPORTANT — Persistent storage:**
   - The boot volume (OS) is free but can be reclaimed. Attach a **Block Volume (200GB)** for your data.
   - We will mount it at `/data` and put the project + DB there.
5. Add **ingress rule** for port 5000 (or skip if using Tailscale only — Tailscale doesn't need open ports).

---

## 2. Mount persistent Block Volume
```bash
sudo mkfs.ext4 /dev/sdb          # the attached block volume
sudo mkdir -p /data
sudo mount /dev/sdb /data
# make persistent across reboots:
echo '/dev/sdb /data ext4 defaults 0 2' | sudo tee -a /etc/fstab
sudo chown -R ubuntu:ubuntu /data
```

---

## 3. Install deps
```bash
sudo apt update && sudo apt install -y nodejs npm git
sudo npm install -g pm2
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

---

## 4. Deploy the project (with data safety)
```bash
mkdir -p /data/trading-analyzer
cd /data/trading-analyzer
git clone https://github.com/arisaliagas-png/trading-analyzer.git .
cd backend && npm install && cd ..

# Copy your REAL .env (with API keys) — NEVER commit this
cp backend/.env.example backend/.env
nano backend/.env   # paste your keys

# Restore your existing trade history (from local backup)
cp "C:/Users/Aris/Documents/trading-analyzer-BACKUP-20260815/backend/data/aris.db" /data/trading-analyzer/backend/data/aris.db

# Start
bash deploy/start.sh
```

**Data is now on /data (persistent volume) — survives VM stop/start/reboot.**

---

## 5. Hourly DB backup (zero data-loss guarantee)
```bash
crontab -e
# Add:
0 * * * * /data/trading-analyzer/deploy/backup-db.sh
```
Keeps 48 hourly snapshots. Even if the DB corrupts, you lose at most 1 hour.

---

## 6. Access from anywhere (Tailscale)
On your **phone / laptop**:
1. Install Tailscale app, log in with same account
2. The VM gets a private IP like `100.64.x.x`
3. Open browser: `http://100.64.x.x:5000`

**No port forwarding, no public exposure, encrypted, only you can reach it.**

---

## 7. Maintenance
- Status: `pm2 status` / `pm2 logs trading-analyzer`
- Restart: `pm2 restart trading-analyzer`
- Update code: `git pull && cd backend && npm install && pm2 restart trading-analyzer`
- DB backup location: `backend/data/backups/`

---

## Security notes
- `.env` is gitignored — keys never committed.
- Tailscale = zero-trust mesh VPN; only devices you approve can reach the VM.
- No public IP / domain needed → no attack surface.
- If you ever expose it publicly (not recommended), add auth (Cloudflare Access) immediately.
