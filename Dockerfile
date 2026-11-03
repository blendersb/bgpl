# Use official lightweight Node.js LTS image on Alpine
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy package dependency files
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm ci --only=production

# Copy the rest of the application source code
COPY . .

# Ensure the local uploads directory exists for Multer
RUN mkdir -p public/uploads

# Expose the application port
EXPOSE 5000

# Set default environment variables
ENV PORT=5000

# Start the Node.js application
CMD ["node", "server.js"]