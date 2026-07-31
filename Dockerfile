# Build the simulator bundle, then serve it and the API from one Python process.
#
# The front end is compiled in a Node stage and only the resulting static files
# are copied forward, so the runtime image does not carry node_modules.

FROM node:20-slim AS frontend
WORKDIR /build
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py setup.py ./
COPY scripts/ ./scripts/
COPY data/processed/ ./data/processed/
COPY models/ ./models/

# The compiled page plus the CC0 models it loads at runtime.
COPY --from=frontend /build/dist/ ./app/dist/
COPY app/public/models/ ./app/dist/models/

EXPOSE 8000
CMD ["python", "main.py", "serve"]
