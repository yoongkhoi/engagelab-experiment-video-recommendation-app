export const publicRoutes = [
    'GET /api/health',
    'GET /api/config/status',
    'GET /api/openapi.yaml',
    'GET /api/videos',
    'GET /api/videos/:id',
    'POST /api/devices/register',
] as const;

export const deviceRoutes = [
    'PUT /api/devices/:id/preferences',
    'POST /api/events',
] as const;

export const adminRoutes = [
    'POST /api/videos',
    'PUT /api/videos/:id',
    'DELETE /api/videos/:id',
    'GET /api/devices',
    'GET /api/devices/:id',
    'POST /api/devices/:id/sync-tags',
    'POST /api/campaigns',
    'GET /api/campaigns',
    'GET /api/campaigns/:id',
    'POST /api/campaigns/:id/send',
    'POST /api/campaigns/:id/schedule',
    'POST /api/experiments',
    'GET /api/experiments',
    'GET /api/experiments/:id',
    'POST /api/experiments/:id/start',
    'GET /api/analytics/overview',
    'GET /api/analytics/campaigns',
    'GET /api/analytics/videos',
    'GET /api/analytics/experiments',
    'GET /api/engagelab/status',
    'POST /api/engagelab/test-push',
] as const;
