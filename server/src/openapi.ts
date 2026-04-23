/**
 * Hand-authored OpenAPI 3.0 spec covering the API surface. Lives next to
 * the routes it documents and is served at /api/docs (Swagger UI) and
 * /api/openapi.json.
 *
 * Keep this in sync with the routers under `src/routes/`. When a new route
 * ships, extend `paths` below and add the request/response schemas under
 * `components.schemas`.
 */
export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'ASEL Mobile — Stock Management API',
    version: '1.0.0',
    description:
      'Multi-franchise stock management, sales, and transfer API. All ' +
      'endpoints require the `asel_session` httpOnly cookie unless noted. ' +
      'Responses use the envelope `{ error: { code, message, details } }` ' +
      'on failure.',
  },
  servers: [{ url: '/api', description: 'Default' }],
  tags: [
    { name: 'auth', description: 'Authentication and session' },
    { name: 'users', description: 'User administration (admin)' },
    { name: 'franchises', description: 'Franchise administration' },
    { name: 'catalog', description: 'Categories, suppliers, products' },
    { name: 'stock', description: 'Per-franchise stock and movements' },
    { name: 'sales', description: 'Point-of-sale transactions' },
    { name: 'transfers', description: 'Inter-franchise transfers' },
    { name: 'reports', description: 'Dashboard and audit' },
    { name: 'ops', description: 'Health and metrics' },
  ],
  components: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'asel_session' },
    },
    schemas: {
      ErrorEnvelope: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: {},
            },
          },
        },
      },
      Role: { type: 'string', enum: ['admin', 'manager', 'franchise', 'seller'] },
      User: {
        type: 'object',
        required: ['id', 'username', 'fullName', 'role'],
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          fullName: { type: 'string' },
          role: { $ref: '#/components/schemas/Role' },
          franchiseId: { type: 'string', nullable: true },
          active: { type: 'boolean' },
          lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Franchise: {
        type: 'object',
        required: ['id', 'name', 'active'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          address: { type: 'string' },
          phone: { type: 'string' },
          manager: { type: 'string' },
          active: { type: 'boolean' },
        },
      },
      Category: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
      Supplier: {
        type: 'object',
        required: ['id', 'name', 'active'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          phone: { type: 'string' },
          email: { type: 'string', format: 'email' },
          address: { type: 'string' },
          active: { type: 'boolean' },
        },
      },
      Product: {
        type: 'object',
        required: ['id', 'name', 'categoryId', 'sellPrice', 'active'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          categoryId: { type: 'string' },
          supplierId: { type: 'string', nullable: true },
          brand: { type: 'string' },
          reference: { type: 'string' },
          barcode: { type: 'string' },
          description: { type: 'string' },
          purchasePrice: { type: 'number', minimum: 0 },
          sellPrice: { type: 'number', minimum: 0 },
          lowStockThreshold: { type: 'integer', minimum: 0 },
          active: { type: 'boolean' },
        },
      },
      StockItem: {
        type: 'object',
        required: ['franchiseId', 'productId', 'quantity'],
        properties: {
          franchiseId: { type: 'string' },
          productId: { type: 'string' },
          quantity: { type: 'integer', minimum: 0 },
          product: { $ref: '#/components/schemas/Product' },
        },
      },
      SaleItem: {
        type: 'object',
        required: ['productId', 'quantity', 'unitPrice'],
        properties: {
          productId: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
          unitPrice: { type: 'number', minimum: 0 },
          total: { type: 'number', minimum: 0 },
        },
      },
      Sale: {
        type: 'object',
        required: ['id', 'franchiseId', 'items', 'total'],
        properties: {
          id: { type: 'string' },
          franchiseId: { type: 'string' },
          userId: { type: 'string' },
          items: { type: 'array', items: { $ref: '#/components/schemas/SaleItem' } },
          subtotal: { type: 'number' },
          discount: { type: 'number' },
          total: { type: 'number' },
          paymentMethod: { type: 'string', enum: ['cash', 'card', 'transfer', 'other'] },
          note: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Transfer: {
        type: 'object',
        required: ['id', 'sourceFranchiseId', 'destFranchiseId', 'productId', 'quantity', 'status'],
        properties: {
          id: { type: 'string' },
          sourceFranchiseId: { type: 'string' },
          destFranchiseId: { type: 'string' },
          productId: { type: 'string' },
          quantity: { type: 'integer', minimum: 1 },
          status: { type: 'string', enum: ['pending', 'accepted', 'rejected', 'cancelled'] },
          note: { type: 'string' },
        },
      },
    },
  },
  security: [{ sessionCookie: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['ops'],
        summary: 'Liveness + DB readiness probe',
        security: [],
        responses: {
          '200': {
            description: 'Server up and database reachable',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    db: { type: 'string', enum: ['up', 'down'] },
                    time: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          '503': { description: 'Database not reachable' },
        },
      },
    },
    '/metrics': {
      get: {
        tags: ['ops'],
        summary: 'Prometheus metrics (text exposition)',
        security: [],
        responses: {
          '200': {
            description: 'Prometheus 0.0.4 text format',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Exchange credentials for a session cookie',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Authenticated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { user: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
          '401': {
            description: 'Invalid credentials',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
          },
          '423': {
            description: 'Account locked after too many failed attempts',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
          },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/auth/logout': {
      post: { tags: ['auth'], summary: 'Clear the session cookie', responses: { '200': { description: 'OK' } } },
    },
    '/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Return the currently authenticated user',
        responses: {
          '200': {
            description: 'Current user',
            content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } },
          },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['auth'],
        summary: 'Change the current user’s password',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: {
                    type: 'string',
                    minLength: 10,
                    description: 'Must contain at least 3 of {lowercase, uppercase, digit, symbol}.',
                  },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Changed' }, '400': { description: 'Invalid' }, '401': { description: 'Not authenticated' } },
      },
    },
    '/users': {
      get: {
        tags: ['users'], summary: 'List users (admin)',
        responses: { '200': { description: 'Users', content: { 'application/json': { schema: { type: 'object', properties: { users: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } } } },
      },
      post: { tags: ['users'], summary: 'Create a user (admin)', responses: { '201': { description: 'Created' } } },
    },
    '/users/{id}': {
      patch: { tags: ['users'], summary: 'Update a user (admin)', responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['users'], summary: 'Deactivate a user (admin)', responses: { '200': { description: 'Deactivated' } } },
    },
    '/franchises': {
      get: { tags: ['franchises'], summary: 'List visible franchises', responses: { '200': { description: 'OK' } } },
      post: { tags: ['franchises'], summary: 'Create a franchise (admin)', responses: { '201': { description: 'Created' } } },
    },
    '/categories': {
      get: { tags: ['catalog'], summary: 'List categories', responses: { '200': { description: 'OK' } } },
      post: { tags: ['catalog'], summary: 'Create a category (admin/manager)', responses: { '201': { description: 'Created' } } },
    },
    '/suppliers': {
      get: { tags: ['catalog'], summary: 'List suppliers', responses: { '200': { description: 'OK' } } },
      post: { tags: ['catalog'], summary: 'Create a supplier (admin/manager)', responses: { '201': { description: 'Created' } } },
    },
    '/products': {
      get: {
        tags: ['catalog'], summary: 'Search products',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'categoryId', in: 'query', schema: { type: 'string' } },
          { name: 'active', in: 'query', schema: { type: 'boolean' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
        ],
        responses: { '200': { description: 'Products' } },
      },
      post: { tags: ['catalog'], summary: 'Create a product (admin/manager)', responses: { '201': { description: 'Created' } } },
    },
    '/stock': {
      get: {
        tags: ['stock'], summary: 'List stock for a franchise',
        parameters: [
          { name: 'franchiseId', in: 'query', schema: { type: 'string' }, required: false },
          { name: 'lowOnly', in: 'query', schema: { type: 'boolean' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Stock items', content: { 'application/json': { schema: { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/components/schemas/StockItem' } } } } } } } },
      },
    },
    '/stock/entry': {
      post: { tags: ['stock'], summary: 'Record a stock entry (IN)', responses: { '201': { description: 'Applied' } } },
    },
    '/stock/adjust': {
      post: { tags: ['stock'], summary: 'Manual stock adjustment (admin/manager)', responses: { '201': { description: 'Applied' } } },
    },
    '/stock/movements': {
      get: { tags: ['stock'], summary: 'List recent movements', responses: { '200': { description: 'OK' } } },
    },
    '/sales': {
      get: {
        tags: ['sales'], summary: 'List sales (franchise-scoped)',
        parameters: [
          { name: 'franchiseId', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: { '200': { description: 'Sales' } },
      },
      post: {
        tags: ['sales'], summary: 'Record a sale (decrements stock atomically)',
        responses: { '201': { description: 'Sale created', content: { 'application/json': { schema: { type: 'object', properties: { sale: { $ref: '#/components/schemas/Sale' } } } } } }, '400': { description: 'Insufficient stock or invalid input' } },
      },
    },
    '/sales/{id}': {
      get: { tags: ['sales'], summary: 'Retrieve a sale', responses: { '200': { description: 'Sale' }, '404': { description: 'Not found' } } },
    },
    '/transfers': {
      get: { tags: ['transfers'], summary: 'List transfers (franchise-scoped)', responses: { '200': { description: 'OK' } } },
      post: { tags: ['transfers'], summary: 'Request a transfer', responses: { '201': { description: 'Pending' } } },
    },
    '/transfers/{id}/accept': {
      post: { tags: ['transfers'], summary: 'Accept (atomic stock swap)', responses: { '200': { description: 'Accepted' }, '400': { description: 'Insufficient source stock' }, '409': { description: 'Already resolved' } } },
    },
    '/transfers/{id}/reject': {
      post: { tags: ['transfers'], summary: 'Reject a pending transfer', responses: { '200': { description: 'Rejected' } } },
    },
    '/dashboard': {
      get: { tags: ['reports'], summary: 'KPIs, low-stock list, recent sales', responses: { '200': { description: 'OK' } } },
    },
    '/audit': {
      get: { tags: ['reports'], summary: 'Audit log (admin)', responses: { '200': { description: 'OK' } } },
    },
  },
} as const;
