# User Service

Microservice responsible for user management, authentication, authorization and attempt tracking.

---

## Overview

This service handles:
- User profile management
- Role based access control
- Firebase ID token verification
- User question attempt history
- Administrative user operations

All authentication is delegated to Firebase Auth. This service does not handle passwords or credentials directly.

---

## Running the Service

### Prerequisites
1.  Node.js 20+
2.  Firebase Admin service account credentials
3.  Firebase project configured

### Local Development
```bash
cd services/user-service

# Install dependencies
npm install

# Create environment file
cp .env.sample .env
# Edit .env with Firebase credentials

# Run in development mode with hot reload
npm run dev
```

Service will be available at: `http://localhost:3001`

### Run with Docker
```bash
# From project root
docker compose build user-service
docker compose up -d user-service
```

### Health Check
```bash
curl http://localhost:3001/
```

---

## Testing
```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run single test file
npm run test test/user-controller.test.js
```

---

## Data Storage Architecture

This service uses **Firebase Firestore** for all data storage.

### Collections

| Collection | Purpose |
|---|---|
| `users` | User profiles, roles and account information |
| `question_attempts` | History of all question attempts by users |

### User Document Structure
```javascript
{
  id: "firebase_uid",
  firebaseuuid: "firebase_uid",
  email: "user@example.com",
  username: "exampleuser",
  role: "user" | "admin",
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Roles System
Roles are stored in **two locations**:
1.  Firestore user document (persistent source of truth)
2.  Firebase Custom Claims (cached inside JWT tokens for 60 minutes)

All authorization checks across the entire system trust the role value directly from the JWT token without database lookups.

---

## System Invariants
Protected by atomic Firestore transactions:
- Cannot delete the last remaining administrator
- Cannot demote the last remaining administrator
- All operations are atomic and race condition proof

---

## First Admin Setup
To create the first admin user:
```bash
cd services/user-service
node scripts/firstAdmin.js <firebase_user_uid>
```

This will set both Firestore role and Firebase custom claims. Subsequent admins can be created via the API by existing admins.

---

## Authentication
All protected endpoints require a valid Firebase ID token in the request header:
```
Authorization: Bearer <FIREBASE_ID_TOKEN>
```

Tokens are verified cryptographically using Firebase Admin SDK without external network calls.

---

## Important Notes
- Role changes can take up to 60 minutes to propagate to existing tokens
- Users must log out and log back in to receive new permissions immediately
- This service has no dependencies on any other PeerPrep service
- All endpoints are fully stateless

## API Endpoints

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/register` | Create user profile after Firebase authentication |
| POST | `/auth/forgot-password` | Initiate password reset flow |

### User Management
| Method | Endpoint | Access | Description |
|---|---|---|---|
| GET | `/users` | Admin | List all users |
| GET | `/users/:id` | Owner/Admin | Get single user profile |
| PATCH | `/users/:id` | Owner/Admin | Update user profile |
| DELETE | `/users/:id` | Owner/Admin | Delete user |
| PATCH | `/users/:id/privilege` | Admin | Change user role |

### Attempt History
| Method | Endpoint | Access | Description |
|---|---|---|---|
| POST | `/users/:id/attempts` | System | Record question attempt |
| GET | `/users/:id/attempts` | Owner/Admin | Get paginated attempt history |
| GET | `/users/:id/attempts/summary` | Owner/Admin | Get user attempt statistics |

---

## API Guide

### Register User Profile

- Purpose: Create a user profile in MongoDB using an already-authenticated Firebase user.
- HTTP Method: `POST`
- Endpoint: <http://localhost:3001/auth/register>
- Headers
  - Required: `Authorization: Bearer <FIREBASE_ID_TOKEN>`
- Body
  - Optional: `username` (string), `name` (string)

    ```json
    {
      "username": "sampleUser"
    }
    ```

Behavior:

- If user does not exist in Firestore: creates user with role `user`, returns `201`.
- If user already exists: returns existing user, `200`.
- On first registration, Firebase custom claim `role: "user"` is set.

---

### Forgot Password

- Method: `POST`
- Endpoint: `/auth/forgot-password`
- Body:

```json
{
  "email": "user@example.com"
}
```

Behavior:

- If email is valid and exists in Firebase Auth: returns `200` with a reset link.
- If email does not exist: returns `200` with a generic message.
- If email is missing: returns `400`.

- Responses:

    | Response Code               | Explanation                                  |
    |-----------------------------|----------------------------------------------|
    | 201 (Created)               | User registered in MongoDB                   |
    | 200 (OK)                    | User already registered                      |
    | 401 (Unauthorized)          | Missing/invalid Firebase ID token            |
    | 500 (Internal Server Error) | Firebase/database/server error               |

### Update User Privilege

You need an admin token to use this endpoint.

- Purpose: Update role in MongoDB and sync Firebase custom claim.
- HTTP Method: `PATCH`
- Endpoint: <http://localhost:3001/users/{userId}/privilege>
- Parameters
  - Required: `userId` (MongoDB Object ID)
- Headers
  - Required: `Authorization: Bearer <FIREBASE_ID_TOKEN>`
  - Auth Rule: Admin users only
- Body
  - Required: `role` (string)
  - Allowed values: `"admin"`, `"user"`

    ```json
    {
      "role": "admin"
    }
    ```

- Responses:

    | Response Code               | Explanation                                  |
    |-----------------------------|----------------------------------------------|
    | 200 (OK)                    | Role updated in MongoDB and Firebase claim   |
    | 400 (Bad Request)           | Missing/invalid role                         |
    | 401 (Unauthorized)          | Missing/invalid Firebase ID token            |
    | 403 (Forbidden)             | Caller is not admin                          |
    | 404 (Not Found)             | User not found                               |
    | 500 (Internal Server Error) | Database/server error                        |

### Get User

- This endpoint allows retrieval of a single user's data from the database using the user's ID.

  > 💡 The user ID refers to the MongoDB Object ID, a unique identifier automatically generated by MongoDB for each document in a collection.

- HTTP Method: `GET`

- Endpoint: <http://localhost:3001/users/{userId}>

- Parameters
  - Required: `userId` path parameter
  - Example: `http://localhost:3001/users/60c72b2f9b1d4c3a2e5f8b4c`

- Headers

  - Required: `Authorization: Bearer <FIREBASE_ID_TOKEN>`

  - Explanation: This endpoint requires a Firebase ID token in the request header for authentication and authorization. The server verifies this token with Firebase Admin SDK.

  - Auth Rules:

    - Admin users: Can retrieve any user's data. The server verifies the user associated with the Firebase token is an admin user and allows access to the requested user's data.

    - Non-admin users: Can only retrieve their own data. The server checks if the user ID in the request URL matches the ID of the user associated with the Firebase token. If it matches, the server returns the user's own data.

- Responses:

    | Response Code               | Explanation                                              |
    |-----------------------------|----------------------------------------------------------|
    | 200 (OK)                    | Success, user data returned                              |
    | 401 (Unauthorized)          | Access denied due to missing/invalid/expired token       |
    | 403 (Forbidden)             | Access denied for non-admin users accessing others' data |
    | 404 (Not Found)             | User with the specified ID not found                     |
    | 500 (Internal Server Error) | Database or server error                                 |

### Get All Users

- This endpoint allows retrieval of all users' data from the database.
- HTTP Method: `GET`
- Endpoint: <http://localhost:3001/users>
- Headers
  - Required: `Authorization: Bearer <FIREBASE_ID_TOKEN>`
  - Auth Rules:

    - Admin users: Can retrieve all users' data. The server verifies the user associated with the Firebase token is an admin user and allows access to all users' data.

    - Non-admin users: Not allowed access.

- Responses:

    | Response Code               | Explanation                                      |
    |-----------------------------|--------------------------------------------------|
    | 200 (OK)                    | Success, all user data returned                  |
    | 401 (Unauthorized)          | Access denied due to missing/invalid/expired token |
    | 403 (Forbidden)             | Access denied for non-admin users                |
    | 500 (Internal Server Error) | Database or server error                         |

### Update User

- This endpoint allows updating a user and their related data in the database using the user's ID.

- HTTP Method: `PATCH`

- Endpoint: <http://localhost:3001/users/{userId}>

- Parameters
  - Required: `userId` path parameter

- Body
  - Required: `username` (string)

    ```json
    {
      "username": "SampleUserName"
    }
    ```

- Headers
  - Required: `Authorization: Bearer <FIREBASE_ID_TOKEN>`
  - Auth Rules:

    - Admin users: Can update any user's data. The server verifies the user associated with the Firebase token is an admin user and allows the update of requested user's data.

    - Non-admin users: Can only update their own data. The server checks if the user ID in the request URL matches the ID of the user associated with the Firebase token. If it matches, the server updates the user's own data.

- Responses:

    | Response Code               | Explanation                                             |
    |-----------------------------|---------------------------------------------------------|
    | 200 (OK)                    | User updated successfully, updated user data returned   |
    | 400 (Bad Request)           | Missing username or duplicate username                  |
    | 401 (Unauthorized)          | Access denied due to missing/invalid/expired token      |
    | 403 (Forbidden)             | Access denied for non-admin users updating others' data |
    | 404 (Not Found)             | User with the specified ID not found                    |
    | 500 (Internal Server Error) | Database or server error                                |

### Delete User

- This endpoint allows deletion of a user and their related data from the database using the user's ID.
- HTTP Method: `DELETE`
- Endpoint: <http://localhost:3001/users/{userId}>
- Parameters

  - Required: `userId` path parameter
- Headers

  - Required: `Authorization: Bearer <FIREBASE_ID_TOKEN>`

  - Auth Rules:

    - Admin users: Can delete any user's data. The server verifies the user associated with the Firebase token is an admin user and allows the deletion of requested user's data.

    - Non-admin users: Can only delete their own data. The server checks if the user ID in the request URL matches the ID of the user associated with the Firebase token. If it matches, the server deletes the user's own data.
- Responses:

    | Response Code               | Explanation                                             |
    |-----------------------------|---------------------------------------------------------|
    | 200 (OK)                    | User deleted successfully                               |
    | 401 (Unauthorized)          | Access denied due to missing/invalid/expired token      |
    | 403 (Forbidden)             | Access denied for non-admin users deleting others' data |
    | 404 (Not Found)             | User with the specified ID not found                    |
    | 500 (Internal Server Error) | Database or server error                                |
