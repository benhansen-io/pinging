# Frontend build stage
FROM node:slim AS build-frontend
WORKDIR /app
COPY ./frontend /app
RUN npm install
RUN npm run build

# Backend build stage
FROM rust:latest AS build-backend
WORKDIR /app
COPY ./backend /app
RUN cargo build --release

# Runtime stage
FROM debian:bookworm-slim AS run
RUN apt-get update && \
  apt-get install -y ca-certificates && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build-frontend /app/dist /app/public
COPY --from=build-backend /app/target/release/pinging /app/pinging
USER nobody
EXPOSE 8000/tcp 8888/udp
ENTRYPOINT ["/app/pinging"]