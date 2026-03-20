FROM node:20-alpine as build
WORKDIR /app
COPY package*.json ./
# Use npm install safely, simulating standard build if needed.
# Since we manually created package.json, we need a package-lock.json or just install.
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
