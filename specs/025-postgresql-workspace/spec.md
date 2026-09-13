# PostgreSQL Workspace

## User Value

Users can manage local PostgreSQL connection profiles, inspect database objects, run SQL, and review tabular results without leaving the application.

## User Scenarios

### Manage a connection

A user opens the Database workspace, creates a PostgreSQL connection profile, edits it later, or deletes it when it is no longer needed.

### Explore database objects

A user connects to a saved profile and expands schemas, tables, views, and columns in an object explorer.

### Run a query

A user writes SQL, runs it against the active connection, and reviews each result set, affected row count, execution duration, or database error.

## Functional Requirements

- **FR-001**: The activity bar MUST provide a Database workspace without replacing the existing conversation, specification, terminal, or Git interfaces.
- **FR-002**: Users MUST be able to create, list, edit, and delete PostgreSQL connection profiles.
- **FR-003**: Connection API responses MUST NOT include saved passwords.
- **FR-004**: Saved connection profiles MUST be stored under the application filesystem state root with owner-only file permissions.
- **FR-005**: Users MUST be able to test a saved connection before querying it.
- **FR-006**: The object explorer MUST list non-system schemas and their tables, partitioned tables, views, materialized views, and columns.
- **FR-007**: Users MUST be able to execute SQL from the query editor using a button or Ctrl/Cmd+Enter.
- **FR-008**: The results viewer MUST show columns, rows, affected row counts, multiple result sets, execution duration, and database errors.
- **FR-009**: The results viewer MUST cap displayed rows at 1,000 per result set and disclose truncation.
- **FR-010**: Database connections and queries MUST time out instead of waiting indefinitely.
- **FR-011**: This initial feature MUST support PostgreSQL only.
- **FR-012**: The query editor MUST persist and restore a separate SQL draft for each saved connection across page reloads and application restarts.

## Key Entities

- **Connection Profile**: A named PostgreSQL host, port, database, user, password, and SSL preference.
- **Database Schema**: A namespace containing queryable objects.
- **Database Object**: A table or view and its columns.
- **Query Result**: Command metadata, field definitions, serialized rows, affected row count, duration, and truncation state.

## Success Criteria

- A user can save a valid local PostgreSQL profile and connect to it from the Database workspace.
- A connected user can discover a table and generate a starter `SELECT` statement by double-clicking it.
- A query result with ordinary scalar, date, binary, JSON, and null values renders without serialization failure.
- Existing automated tests and Nuxt type checking continue to pass.

## Assumptions

- The product runs as a local, single-user application.
- Users trust the local machine account that owns the application state directory.
- SSL certificate verification is outside the initial local-development scope.
- Query cancellation, SQL autocomplete, export, explain plans, charts, and additional database engines are outside this feature.
