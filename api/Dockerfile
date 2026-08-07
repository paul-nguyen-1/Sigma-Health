FROM golang:1.20-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/server ./cmd/server
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/migrate ./cmd/migrate

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /out/migrate /
COPY migrations/ /migrations/
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]
