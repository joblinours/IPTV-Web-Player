FROM node:22-alpine AS builder
WORKDIR /app
ARG VITE_API_BASE_URL=
ARG VITE_APP_VERSION=
ARG VITE_GIT_COMMIT=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_GIT_COMMIT=$VITE_GIT_COMMIT
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runner
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
