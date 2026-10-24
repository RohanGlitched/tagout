# The daily recall sweep as a container job (Nebius AI Cloud Serverless Jobs, or any scheduler).
#   docker build -t tagout-sweep .
#   docker run --rm -e NEBIUS_API_KEY -e TAVILY_API_KEY -e GCS_BUCKET -e GCS_SA_KEY tagout-sweep
# Extra arguments go to scripts/sweep.mts (e.g. --dry, --max-reads=10, --prefix=sweep-test/).
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
# tsx (a dev dependency) runs the TypeScript directly; no Next build is needed for the job.
RUN npm ci --include=dev --ignore-scripts && npm cache clean --force
COPY tsconfig.json ./
COPY lib ./lib
COPY scripts/sweep.mts ./scripts/sweep.mts
RUN mkdir -p .data && chown node .data
USER node
ENTRYPOINT ["npx", "--no-install", "tsx", "--conditions=react-server", "scripts/sweep.mts"]
