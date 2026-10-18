FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics \
    MPLCONFIGDIR=/tmp/matplotlib \
    OMP_NUM_THREADS=2 \
    GROUNDWORK_DATA_DIR=/var/data/groundwork \
    GROUNDWORK_MODEL_PATH=/app/groundworkAI/models/best.pt

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY groundworkAI/requirements.txt /app/groundworkAI/requirements.txt
# CPU inference needs no CUDA libraries or training GPU.
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r groundworkAI/requirements.txt
COPY groundworkAI /app/groundworkAI
RUN test -s /app/groundworkAI/models/best.pt

EXPOSE 8000
CMD ["sh", "-c", "exec python -m uvicorn api:app --app-dir groundworkAI --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
