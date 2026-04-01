##
## Stage 1: Build frontend
##
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

##
## Stage 2: Build Go binary
##
FROM golang:1.26-alpine AS backend
ARG VERSION=dev
ARG BUILD_DATE=unknown
WORKDIR /app
COPY go.mod ./
COPY go.sum* ./
COPY . .
COPY --from=frontend /app/frontend/dist ./cmd/server/frontend/dist
RUN go mod tidy && go mod download
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w \
    -X wansaturator/internal/version.Version=${VERSION} \
    -X wansaturator/internal/version.BuildDate=${BUILD_DATE}" \
    -o /wansaturator ./cmd/server

##
## Stage 3: Runtime
##
FROM gcr.io/distroless/static-debian12
COPY --from=backend /wansaturator /wansaturator
EXPOSE 7860
VOLUME /data
ENV DATA_DIR=/data
ENTRYPOINT ["/wansaturator"]
