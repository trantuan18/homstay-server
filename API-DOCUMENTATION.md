# Homestay API — Technical Documentation

## 1. Architecture

```text
React / Admin Frontend
        |
        | Bearer JWT
        v
Fastify API
        |
        +--> Supabase Auth
        |
        +--> PostgreSQL
        |      +--> RLS
        |      +--> constraints
        |      +--> RPC
        |      +--> triggers
        |
        +--> Supabase Storage
```

Core hierarchy:

```text
User -> Property (many) -> Room (many)
                         -> Images
                         -> Amenities
                         -> Pricing Rules
                         -> Blocked Periods

Customer -> Booking -> Payment
```

A Property owns its booking configuration, including timezone, booking interval and min/max duration.

## 2. Authentication

Supabase Auth owns credentials and JWTs.

Register:
`POST /api/auth/register`

The `handle_new_user()` trigger creates `profiles` and `user_roles`, defaulting new users to `CUSTOMER`.

Login:
`POST /api/auth/login`

The API returns `access_token` and `refresh_token`.

Authenticated requests:

```http
Authorization: Bearer <access_token>
```

Current user:
`GET /api/auth/me`

## 3. Roles and permissions

| Role | Main scope |
|---|---|
| CUSTOMER | Own profile, own bookings, notifications, reviews |
| HOST | Own Properties, Rooms, images/configuration |
| STAFF | Reserved operational role; not automatically Admin |
| ADMIN | Full administration |
| SUPER_ADMIN | Admin plus SUPER_ADMIN role assignment |

Admin authorization is backend-enforced through `is_admin()`. Frontend checks are only UX guards.

## 4. Security layers

```text
JWT validation
    ↓
Fastify authentication
    ↓
Role/ownership authorization
    ↓
RLS and/or Security Definer RPC
    ↓
PostgreSQL
```

The browser must never receive `SUPABASE_SERVICE_ROLE_KEY`.

## 5. Booking flow

Current business model is Admin-created booking:

```text
Admin creates booking
        ↓
PENDING / UNPAID
        ↓
Admin records manual payment
        ↓
PAID
        ↓
CONFIRMED
        ↓
CHECKED_IN
        ↓
CHECKED_OUT
```

Implemented status transitions:

```text
PENDING -> CONFIRMED | CANCELLED | EXPIRED
CONFIRMED -> CHECKED_IN | CANCELLED | NO_SHOW
CHECKED_IN -> CHECKED_OUT
```

Terminal states are CHECKED_OUT, CANCELLED, EXPIRED and NO_SHOW.

`CHECKED_IN` requires `PAID` or `PARTIAL`.

## 6. Booking conflict protection

Availability checks consider room/property status, blocked periods and active bookings.

Database exclusion constraint prevents overlapping active bookings for the same room:

```text
room_id + tstzrange(start_at, end_at, '[)')
```

Active statuses protected by the constraint:

```text
PENDING
CONFIRMED
CHECKED_IN
```

Adjacent intervals are allowed.

## 7. Pricing

`calculate_booking_price()` calculates duration and selects active pricing rules by day/time/duration/priority.

Current defaults include VND currency, zero tax and zero discount.

## 8. Payment

There is currently no external payment gateway.

Admin uses:

`PATCH /api/admin/bookings/:bookingId/payment`

Supported payment statuses:

```text
UNPAID
PARTIAL
PAID
FAILED
REFUNDED
```

Manual payment creates a `payments` record and updates booking payment state. When a PENDING booking is marked PAID, the current RPC can move it to CONFIRMED.

## 9. Notifications and audit

A booking update trigger observes booking status and payment status changes.

It can create notifications for the booking owner and audit entries such as:

```text
BOOKING_STATUS_CHANGED
BOOKING_PAYMENT_STATUS_CHANGED
```

## 10. Storage

Bucket:

```text
room-images
```

Rules:

- public read
- max 5 MB/image
- JPG/PNG/WEBP

Path:

```text
property_id/room_id/unique-file.ext
```

`room_images.public_id` stores the Storage path.

Each room has at most one `is_primary = true` image through a partial unique index.

## 11. API groups

### Public

```text
GET /api/properties
GET /api/properties/:id
GET /api/rooms
GET /api/rooms/:id
GET /api/search/properties
GET /api/search/rooms
GET /api/search/rooms/available
GET /api/rooms/:roomId/availability
GET /api/rooms/:roomId/reviews
GET /api/reviews/:id
```

### Customer/authenticated

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
PATCH /api/auth/me

GET/POST /api/bookings
GET /api/bookings/:id
GET /api/bookings/:id/detail
POST /api/bookings/:id/cancel
GET /api/bookings/price

GET /api/notifications
GET /api/notifications/:id
PATCH /api/notifications/:id/read
PATCH /api/notifications/read-all

POST /api/bookings/:bookingId/review
PATCH /api/reviews/:id
```

### Host

```text
POST/PATCH/DELETE /api/properties...
POST/PATCH/DELETE /api/rooms...
POST/PATCH/DELETE /api/rooms/:roomId/images...
POST /api/amenities
POST/DELETE /api/rooms/:roomId/amenities...
CRUD /api/rooms/:roomId/pricing-rules
CRUD /api/rooms/:roomId/blocked-periods
```

### Admin

```text
/api/admin/dashboard
/api/admin/analytics
/api/admin/analytics/occupancy
/api/admin/properties...
/api/admin/rooms...
/api/admin/bookings...
/api/admin/bookings/:bookingId/payments
/api/admin/bookings/:bookingId/payment
/api/admin/users...
/api/admin/rooms/:roomId/images/upload
```

## 12. Important implementation notes

Current limitations deliberately deferred:

- External payment gateway is not integrated.
- Search availability uses RPC checks per candidate room and can later be optimized.
- Availability price filtering currently uses base hourly price rather than full calculated pricing.
- Occupancy calculation still needs final treatment of property check-in/check-out and timezone presentation.
- Payment idempotency/transaction uniqueness should be hardened before external gateway integration.
- Booking interval/capacity validation was discussed but not made a blocking change to the current Admin-first flow.

## 13. Swagger

Install:

```bash
npm install @fastify/swagger @fastify/swagger-ui
```

Register before routes in `src/app.ts`:

```ts
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

await app.register(swagger, {
  openapi: {
    info: {
      title: 'Homestay Booking API',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
});

await app.register(swaggerUi, {
  routePrefix: '/docs',
});
```

Then:

```text
http://localhost:3000/docs
```

The included `openapi.yaml` is the consolidated API reference.

## 14. Recommended frontend flow

```text
Login
  ↓
GET /api/auth/me
  ↓
role
  ├─ ADMIN/SUPER_ADMIN → Admin
  └─ other → no Admin access

Admin Dashboard
  ↓
Properties
  ↓
Rooms
  ├─ Images
  ├─ Amenities
  ├─ Pricing
  └─ Blocked Periods
  ↓
Bookings
  ↓
Payment
  ↓
Analytics
```


## 12. Swagger examples

The OpenAPI specification includes request-body, path/query-parameter, response, error, role, booking and manual-payment examples for the current API surface. Use **Authorize** in Swagger UI with the JWT returned by `POST /api/auth/login`, then use **Try it out**.

### Admin login verification

`GET /api/auth/me` should return `role: ADMIN` or `role: SUPER_ADMIN` for the Admin frontend. New Supabase users default to `CUSTOMER`, so an Admin test account must be assigned the appropriate role in `public.user_roles`.

### Admin booking verification

1. `POST /api/admin/bookings` → `PENDING / UNPAID`
2. `PATCH /api/admin/bookings/{bookingId}/payment` with `payment_status: PAID`
3. Verify booking/payment status with the Admin booking endpoints.

Examples use placeholder UUIDs except the development sample Property ID `49036dbf-b863-42b9-aaf6-2d0285dfb422`; replace placeholders with real IDs before sending requests.
