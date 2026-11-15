# Build from the repository root: docker build -f server/Dockerfile .

# the web version of the app, served at /
FROM node:24-alpine AS web
WORKDIR /src/app
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN CI=1 npx expo export --platform web --output-dir /web

# the server
FROM golang:1.27-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /whereis .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
COPY --from=server /whereis /app/whereis
COPY --from=web /web /app/web
ENV WEB_DIR=/app/web
# pb_data holds the database and uploaded photos: keep it on a volume
VOLUME /app/pb_data
EXPOSE 8090
ENTRYPOINT ["/app/whereis"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/app/pb_data"]
