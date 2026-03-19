# Midocean Products Sync for Shopify

Automated product import and synchronization tool that syncs products, prices, and inventory from Midocean API to Shopify.

## Features

- ✅ Automatic product creation and updates
- ✅ Multi-variant product support
- ✅ Price synchronization from pricelist API
- ✅ Inventory/stock level updates
- ✅ Image import (up to 250 images per product)
- ✅ Category filtering and tagging
- ✅ Discontinued product archiving
- ✅ Scheduled automatic sync
- ✅ Duplicate prevention
- ✅ Metafields and tags support
- ✅ Comprehensive error handling with retry logic
- ✅ Detailed logging and error reporting
- ✅ Edge case handling (missing data, malformed responses)
- ✅ Data validation and sanitization

## Table of Contents

- [Quick Reference](#quick-reference)
- [How the Sync Runs](#how-the-sync-runs)
- [How to Trigger It](#how-to-trigger-it)
- [How to Monitor or Troubleshoot](#how-to-monitor-or-troubleshoot)
- [Environment Variables](#environment-variables)
- [Deployment Instructions](#deployment-instructions)
- [Project Structure](#project-structure)
- [Field Mappings](#field-mappings)

## Quick Reference

For detailed commands, see the [Common Commands Reference](#common-commands-reference) table in the Deployment Instructions section.

**Quick Start:**
- **Localhost**: `npm run sync` (manual) or `npm run schedule` (scheduled)
- **Cloudways**: `npm run sync` (manual) or `pm2 start src/scheduler.js --name shopify-sync` (scheduled)
- **Fly.io**: `fly ssh console -C "npm run sync"` (manual) or `fly scale count scheduler=1` (scheduled)
- **Azure**: SSH then `node src/syncFromSupplierAPI.js` (manual) or configure startup command (scheduled)

## How the Sync Runs

### Sync Process Flow

The sync process follows these steps:

1. **Fetch Products**: Retrieves products from Midocean API
2. **Fetch Stock**: Gets inventory levels from stock API
3. **Fetch Pricelist**: Retrieves pricing information from pricelist API
4. **Category Filtering**: Filters products by `category_level1`
5. **Product Creation/Update**:
   - Checks if product exists by SKU
   - Creates new products with variants, images, tags, and metafields
   - Updates prices for existing products
   - Archives discontinued products
6. **Inventory Update**: Updates stock levels for all variants (both new and existing)
7. **Reporting**: Logs success/failure statistics

### How It Runs on Different Platforms

**Localhost:**
- Manual sync runs once and exits
- Scheduled sync runs continuously until stopped (Ctrl+C)
- Uses `node-cron` for scheduling (configured in `config.js`)

**Cloudways (PM2):**
- Scheduler runs as a background process managed by PM2
- Automatically restarts on server reboot (if configured with `pm2 startup`)
- Runs continuously, executing syncs according to `SYNC_SCHEDULE` in `config.js`
- Can run manual syncs alongside the scheduler without interference

**Fly.io:**
- Scheduler runs as a long-running worker process
- Process stays alive between sync runs
- Uses `node-cron` for scheduling (configured in `config.js`)
- Can be manually triggered via SSH without stopping the scheduler

**Azure App Service:**
- Scheduler runs as a web app worker process
- Automatically restarts if the process crashes
- Uses `node-cron` for scheduling (configured in `config.js`)
- Can be manually triggered via SSH

### Sync Flow Diagram

```
Start
  ↓
Fetch Products (Midocean API)
  ↓
Fetch Stock Data (Midocean API)
  ↓
Fetch Pricelist Data (Midocean API)
  ↓
Filter by Category
  ↓
For each product:
  ├─ Check if exists (by SKU)
  ├─ If new → Create product with variants
  ├─ If exists → Update prices
  └─ If discontinued → Archive
  ↓
Update Inventory Levels
  ↓
Report Results
  ↓
End
```

## How to Trigger It

You can trigger the sync in two ways: **Manual Sync** (one-time) or **Scheduled Sync** (automatic, continuous).

### Manual Sync (One-time)

Run a manual sync at any time, even when the scheduler is running. Useful for:
- Testing changes
- Running an immediate sync without waiting for the scheduled time
- Troubleshooting issues
- Processing urgent updates

**What happens during manual sync:**
- ✅ Runs the sync once
- ✅ Processes products by category
- ✅ Updates products, variants, prices, and inventory
- ✅ Exits when complete
- ✅ Logs all activity to console (and log file if configured)

**Commands by Platform:**

| Platform | Command |
|----------|---------|
| **Localhost** | `npm run sync` or `node src/syncFromSupplierAPI.js` |
| **Cloudways** | `npm run sync` or `node src/syncFromSupplierAPI.js` |
| **Fly.io** | `fly ssh console -C "npm run sync"` or `fly ssh console -C "node src/syncFromSupplierAPI.js"` |
| **Azure** | SSH into app, then `node src/syncFromSupplierAPI.js` |

**Note**: Manual sync runs independently and won't interfere with scheduled sync. Both can run simultaneously (the scheduler has built-in protection against overlapping runs).

### Scheduled Sync (Automatic, Continuous)

Start the scheduler for automatic periodic syncs according to `SYNC_SCHEDULE` in `config.js` (default: daily at midnight).

**What the scheduler does:**
- Runs continuously in the background
- Executes syncs at scheduled times (cron expression in `config.js`)
- Prevents overlapping runs (if a sync is still running, it skips the next scheduled time)
- Automatically restarts on server reboot (if configured)

**Commands by Platform:**

| Platform | Start Command | Stop Command |
|----------|---------------|--------------|
| **Localhost** | `npm run schedule` or `npm start` | Press `Ctrl+C` |
| **Cloudways** | `pm2 start src/scheduler.js --name shopify-sync` | `pm2 stop shopify-sync` |
| **Fly.io** | `fly scale count scheduler=1` | `fly scale count scheduler=0` |
| **Azure** | Configure startup command in portal | `az webapp stop` |

**For detailed setup and all commands, see [Deployment Instructions](#deployment-instructions).**

## How to Monitor or Troubleshoot

### Monitoring

#### Console Output

The sync provides detailed console output:

```
Successfully fetched products from API
Loaded 2278 supplier products

Available category_level1 values (15 total):
  1. Drink & lunchware
  2. Outdoor & leisure
  ...

Successfully fetched stock from API
Loaded 97611 stock records
Created stock map with 97611 SKUs

Successfully fetched pricelist from API
Loaded 81846 price records
Created price map with 81846 SKUs

Filtered to 450 products matching categories: Drink & lunchware
Creating/updating products...
Creating product AR1249 with 1 variants
...

Updating inventory for 450 SKUs
Inventory sync complete
Succeeded: 448
Failed: 2
```

#### Platform-Specific Monitoring

**Cloudways (PM2):**
```bash
pm2 logs shopify-sync              # View real-time logs
pm2 logs shopify-sync --lines 100  # View last 100 lines
pm2 monit                          # Monitor resources
pm2 status                         # Check status
```

**Fly.io:**
```bash
fly logs --process scheduler       # View logs
fly logs --follow                  # Follow logs in real-time
fly status                         # Check status
```

**Azure:**
```bash
az webapp log tail --name midocean-sync --resource-group <your-resource-group>
az webapp show --name midocean-sync --resource-group <your-resource-group>
```

**For all monitoring commands, see [Common Commands Reference](#common-commands-reference) in Deployment Instructions.**

### Troubleshooting

#### Common Issues

**1. "Missing env var" Error**

```
Error: Missing env var: SHOPIFY_STORE_DOMAIN
```

**Solution**: Ensure all required environment variables are set in your `.env` file.

**2. "Variant or location not found"**

```
Failed: 1
Sample failures: [
  { sku: 'AR1253-16', success: false, error: 'Variant or location not found' }
]
```

**Solution**: 
- Wait a few seconds after product creation before inventory update
- Check if variant was created successfully
- Verify inventory location exists in Shopify

**3. "Invalid cron expression"**

```
[Scheduler] Invalid cron expression: 0 */6 * * *
```

**Solution**: Check your `SYNC_SCHEDULE` constant in `src/config.js`. Use valid cron syntax.

**4. API Rate Limiting**

The code includes automatic retry logic with exponential backoff for rate limits:
- Automatically detects 429 (rate limit) responses
- Waits for the `retry-after` header or uses exponential backoff
- Retries up to 3 times by default
- Logs all retry attempts

**5. Network/Timeout Errors**

The system handles:
- Connection timeouts (30 second timeout per request)
- Network errors (ECONNREFUSED, ENOTFOUND, ECONNRESET)
- Server errors (5xx) - automatically retried
- Client errors (4xx) - logged but not retried (except 429)

**6. Products Not Updating**

- Check if products exist (they may already be created)
- Verify category filter matches your products
- Check logs for specific error messages

#### Debug Mode

Enable detailed logging by modifying `LOG_LEVEL` in `src/config.js` (set to `'DEBUG'`):

This will show:
- All API requests and responses
- Data validation details
- Retry attempts
- Internal processing steps

#### Error Reporting

The sync provides detailed error reporting:
- **Structured logging** with timestamps and log levels
- **Error categorization** (FETCH_PRODUCTS, PRODUCT_UPSERT, INVENTORY_UPDATE, etc.)
- **Stack traces** for debugging
- **Statistics** on success/failure rates
- **Log file** output (configured in `src/config.js` as `LOG_FILE`)

#### Retry Logic

All API calls include retry logic:
- **Midocean API**: 3 retries with exponential backoff
- **Shopify API**: 3 retries with exponential backoff
- **Rate limiting**: Automatic handling with `retry-after` header support
- **Timeouts**: 30 second timeout per request
- **Network errors**: Automatic retry for transient failures

#### Check Sync Status

See the [Common Commands Reference](#common-commands-reference) table in Deployment Instructions for platform-specific status commands.

## Environment Variables

Create a `.env` file in the project root with the following variables:

### Required Variables

```env
# Shopify Configuration
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_API_VERSION=2024-01
SHOPIFY_ACCESS_TOKEN=your-shopify-access-token

# Midocean API Configuration
MIDOCEAN_BASE_URL=https://api.midocean.com/gateway
MIDOCEAN_API_KEY=your-midocean-api-key
```

### Configuration Constants

All other configuration options (sync schedule, batch sizes, delays, etc.) are defined as constants in `src/config.js` and can be modified directly in that file. See the [Configuration Constants](#configuration-constants) section below for details.

### Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SHOPIFY_STORE_DOMAIN` | ✅ Yes | Your Shopify store domain (e.g., `store.myshopify.com`) |
| `SHOPIFY_API_VERSION` | ✅ Yes | Shopify API version (e.g., `2024-01`) |
| `SHOPIFY_ACCESS_TOKEN` | ✅ Yes | Shopify Admin API access token |
| `MIDOCEAN_BASE_URL` | ✅ Yes | Midocean API base URL |
| `MIDOCEAN_API_KEY` | ✅ Yes | Midocean API key (x-Gateway-APIKey header) |

### Configuration Constants

All other configuration options are defined as constants in `src/config.js`. You can modify these values directly in the config file:

| Constant | Default | Description |
|----------|---------|-------------|
| `SYNC_SCHEDULE` | `'0 0 * * *'` | Cron expression for sync schedule (daily at midnight) |
| `SYNC_TIMEZONE` | `'UTC'` | Timezone for scheduler |
| `METAFIELD_BATCH_SIZE` | `5` | Number of metafields to process per batch |
| `METAFIELD_BATCH_DELAY_MS` | `500` | Delay in milliseconds between metafield batches |
| `API_RATE_LIMIT_THRESHOLD` | `5` | Wait when this many requests away from rate limit |
| `PRODUCT_CREATION_DELAY_MS` | `500` | Delay after product creation (ms) |
| `VARIANT_RETRY_DELAY_MS` | `1000` | Delay before retrying variant operations (ms) |
| `GRAPHQL_PRODUCTS_LIMIT` | `50` | Max products per GraphQL query |
| `GRAPHQL_VARIANTS_LIMIT` | `250` | Max variants per GraphQL query |
| `MAX_PRODUCT_IMAGES` | `250` | Maximum images per product (Shopify limit) |
| `NEW_PRODUCT_STATUS` | `'active'` | Status for newly created products (active, draft, archived) |
| `PRODUCT_LIMIT` | `2` | Limit number of products to process (set to `null` or `0` to process all) |
| `LOG_LEVEL` | `'INFO'` | Logging level (ERROR, WARN, INFO, DEBUG) |
| `LOG_FILE` | `'logs/sync.log'` | Log file path |

**Note**: To change these values, edit `src/config.js` directly. This makes it easy to adjust settings when deploying to servers like Fly.io without managing multiple environment variables.

**Cron Schedule Examples**:
- `"0 0 * * *"` - Daily at midnight (default)
- `"0 */6 * * *"` - Every 6 hours
- `"0 */12 * * *"` - Every 12 hours
- `"*/30 * * * *"` - Every 30 minutes

## Deployment Instructions

### Prerequisites

- Node.js 18+ installed
- npm or yarn package manager
- Access to Midocean API
- Shopify Admin API access token

### Quick Setup Guide

All platforms require the same `.env` file with these variables:
```env
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_API_VERSION=2024-01
SHOPIFY_ACCESS_TOKEN=your-shopify-access-token
MIDOCEAN_BASE_URL=https://api.midocean.com/gateway
MIDOCEAN_API_KEY=your-midocean-api-key
```

---

### Localhost / Local Development

**Setup:**
```bash
# 1. Install dependencies
npm install

# 2. Create .env file with required variables (see above)

# 3. Test the sync
npm run sync
```

**Run Commands:**
```bash
# Manual sync (one-time)
npm run sync
# or
node src/syncFromSupplierAPI.js

# Start scheduled sync (runs continuously)
npm run schedule
# or
npm start
```

**Stop Scheduled Sync:**
- Press `Ctrl+C` in the terminal

---

### Cloudways (Recommended)

**Setup:**
1. Create account and launch server (DigitalOcean recommended, 1GB RAM minimum)
2. SSH into server via Cloudways panel
3. Install Node.js 18+ (if not pre-installed):
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```
4. Upload/clone project:
   ```bash
   git clone <your-repo>
   cd midocean-products-sync
   # or upload files via SFTP
   ```
5. Install dependencies:
   ```bash
   npm install --production
   ```
6. Create `.env` file with required variables
7. Install PM2:
   ```bash
   sudo npm install -g pm2
   ```
8. Start scheduler:
   ```bash
   pm2 start src/scheduler.js --name shopify-sync
   pm2 startup
   pm2 save
   ```

**Run Commands:**
```bash
# Manual sync
npm run sync
# or
node src/syncFromSupplierAPI.js

# View logs
pm2 logs shopify-sync

# Check status
pm2 status

# Restart scheduler
pm2 restart shopify-sync

# Stop scheduler
pm2 stop shopify-sync
```

---

### Fly.io

**Setup:**
1. Install flyctl:
   ```bash
   curl -L https://fly.io/install.sh | sh
   ```
2. Login:
   ```bash
   fly auth login
   ```
3. Initialize (creates `fly.toml`):
   ```bash
   fly launch
   ```
4. Edit `fly.toml`:
   ```toml
   app = "midocean-products-sync"
   primary_region = "iad"

   [build]

   [env]
     NODE_ENV = "production"

   [processes]
     scheduler = "node src/scheduler.js"

   [resources]
     cpu_kind = "shared"
     cpus = 1
     memory_mb = 512
   ```
5. Set environment variables:
   ```bash
   fly secrets set SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
   fly secrets set SHOPIFY_ACCESS_TOKEN=your-token
   fly secrets set SHOPIFY_API_VERSION=2024-01
   fly secrets set MIDOCEAN_BASE_URL=https://api.midocean.com/gateway
   fly secrets set MIDOCEAN_API_KEY=your-key
   ```
6. Deploy:
   ```bash
   fly deploy --process scheduler
   fly scale count scheduler=1
   ```

**Run Commands:**
```bash
# Manual sync
fly ssh console -C "node src/syncFromSupplierAPI.js"
# or
fly ssh console -C "npm run sync"

# View logs
fly logs --process scheduler
fly logs --follow

# Check status
fly status

# Restart scheduler
fly apps restart midocean-products-sync

# Stop scheduler
fly scale count scheduler=0

# Start scheduler
fly scale count scheduler=1
```

---

### Azure App Service

**Setup:**
1. Create Azure App Service (Linux, Node.js 18 LTS)
2. Deploy code via:
   - **Git**: Connect GitHub/Azure DevOps repository
   - **Azure CLI**: `az webapp up --name midocean-sync --runtime "NODE:18-lts"`
   - **VS Code**: Use Azure extension
3. Set environment variables in Azure Portal:
   - Go to Configuration → Application settings
   - Add all required variables (see Quick Setup Guide above)
4. Configure startup command:
   - Go to Configuration → General settings
   - Set startup command: `node src/scheduler.js`

**Run Commands:**
```bash
# Manual sync (via Azure Cloud Shell or SSH)
az webapp ssh --name midocean-sync --resource-group <your-resource-group>
# Then inside SSH:
node src/syncFromSupplierAPI.js

# View logs
az webapp log tail --name midocean-sync --resource-group <your-resource-group>

# Restart app
az webapp restart --name midocean-sync --resource-group <your-resource-group>
```

**Alternative: Azure Functions (Serverless)**
- Use Timer Trigger for scheduled syncs
- Deploy `syncFromSupplierAPI.js` as a function
- Configure cron expression in `function.json`

---

### Common Commands Reference

| Action | Localhost | Cloudways | Fly.io | Azure |
|--------|-----------|-----------|--------|-------|
| **Manual Sync** | `npm run sync` | `npm run sync` | `fly ssh console -C "npm run sync"` | SSH then `node src/syncFromSupplierAPI.js` |
| **Start Scheduler** | `npm run schedule` | `pm2 start src/scheduler.js --name shopify-sync` | `fly scale count scheduler=1` | Auto-starts (configured in portal) |
| **Stop Scheduler** | `Ctrl+C` | `pm2 stop shopify-sync` | `fly scale count scheduler=0` | `az webapp stop` |
| **View Logs** | Console output | `pm2 logs shopify-sync` | `fly logs --process scheduler` | `az webapp log tail` |
| **Check Status** | - | `pm2 status` | `fly status` | `az webapp show` |
| **Restart** | Restart command | `pm2 restart shopify-sync` | `fly apps restart` | `az webapp restart` |


### Post-Deployment Checklist

- [ ] Verify all environment variables are set
- [ ] Test manual sync using platform-specific command (see Common Commands Reference above)
- [ ] Verify scheduler starts and runs successfully
- [ ] Check logs for errors
- [ ] Verify products are being created/updated in Shopify
- [ ] Monitor first few scheduled runs
- [ ] Set up log rotation (if using PM2 on Cloudways)
- [ ] Configure monitoring/alerting (optional)

## Project Structure

```
midocean-products-sync/
├── src/
│   ├── config.js              # Configuration constants and environment variables
│   ├── logger.js               # Logging utility (winston)
│   ├── shopifyClient.js        # Shopify API client (REST & GraphQL)
│   ├── syncFromSupplierAPI.js  # Main sync script
│   ├── upsertProduct.js        # Product creation/update logic
│   ├── metafields.js           # Metafield creation and batch processing
│   ├── inventory.js            # Inventory update logic
│   └── scheduler.js            # Automatic scheduler (node-cron)
├── data/                       # Sample data files (for testing)
│   ├── products.json
│   ├── stock.json
│   └── products-pricelist.json
├── logs/                       # Log files (created automatically)
│   └── sync.log
├── .env                        # Environment variables (create this)
├── fly.toml                    # Fly.io deployment configuration (optional)
├── package.json
└── README.md
```

## Field Mappings

> **📋 Comprehensive Mapping Reference**: For a detailed field mapping spreadsheet, see [MidOcean → Shopify Mapping](https://docs.google.com/spreadsheets/d/1tDh4UZYJUGEn7kukKFVMKNjp7RGQgxIOvxxF_bPpeDk/edit?gid=0#gid=0)

### Images

- Extracted from `variant.digital_assets` where `type === "image"`
- Uses `url_highress` if available, falls back to `url`
- Up to 250 images per product (Shopify limit)
- Images from first variant used as product images

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review logs for specific error messages
3. Verify environment variables are correct
4. Test with a small subset of products first

## License

|||||||||||||||||||||

