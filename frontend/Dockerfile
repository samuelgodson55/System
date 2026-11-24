FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
# Copy the lockfile too and use `npm ci`: it installs the exact locked versions straight from the
# lockfile (no dependency re-resolution), which is much faster and reproducible. This layer is
# cached, so it only re-runs when package.json / package-lock.json change.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --prefer-offline --fetch-retries=5 --fetch-retry-mintimeout=2000
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
