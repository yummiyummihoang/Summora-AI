FROM python:3.12-slim@sha256:05cda9777409a9c3ffddd94a4c476b79f0769a0b4857f0c7ed9226b6800b0d6f
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 STUDIO_MODE=online STUDIO_DATA_DIR=/data
WORKDIR /app
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt && useradd --uid 10001 --create-home studio && mkdir /data && chown studio:studio /data
COPY services/api/summora ./services/api/summora
COPY services/api/resources ./services/api/resources
ENV PYTHONPATH=/app/services/api
USER studio
EXPOSE 8000
CMD ["uvicorn", "summora.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]
