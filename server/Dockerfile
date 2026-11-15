FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /whereis .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /whereis /app/whereis
# pb_data holds the database and uploaded photos: keep it on a volume
VOLUME /app/pb_data
EXPOSE 8090
ENTRYPOINT ["/app/whereis"]
CMD ["serve", "--http=0.0.0.0:8090", "--dir=/app/pb_data"]
