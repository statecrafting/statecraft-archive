# Uptime Monitoring

## Overview

The uptime monitoring system tracks websites and reports their availability. It consists of three backend services (site, monitor, slack) and a React Router frontend.

## Features

- **Site list**: View all monitored websites with current status
- **Add site**: Add a URL to monitor (defaults to https:// if no scheme)
- **Delete site**: Remove a site from monitoring
- **Status polling**: Real-time status updates (1s interval) and site list refresh (10s)

## Architecture

### Site Service (`api/site/`)

- **Database**: PostgreSQL `site` table (id, url)
- **ORM**: Knex
- **Endpoints**:
  - `POST /site` - Add site, publishes to `site.added` topic
  - `GET /site` - List sites
  - `GET /site/:id` - Get site by id
  - `DELETE /site/:id` - Delete site
- **Pub/Sub**: `site.added` topic when a new site is added

### Monitor Service (`api/monitor/`)

- **Database**: PostgreSQL `checks` table (site_id, up, checked_at)
- **Endpoints**:
  - `GET /ping/:url` - Ping a URL, returns up/down
  - `POST /check/:siteID` - Check single site
  - `POST /check-all` - Check all sites
  - `GET /status` - Current status of all sites
- **Cron**: `check-all` runs every 1 hour
- **Pub/Sub**: Subscribes to `site.added` (immediate check on add); publishes to `uptime-transition` on up/down state change

### Slack Service (`api/slack/`)

- **Secret**: `SLACK_WEBHOOK_URL` (optional)
- **Pub/Sub**: Subscribes to `uptime-transition`, sends Slack message on down/up

## Frontend

- **Route**: `web/app/routes/home.tsx` (index)
- **Client**: `~/lib/client` (Encore-generated)
- **Stack**: React Router v7, TanStack Query, Tailwind, Luxon
