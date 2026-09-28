FROM mcr.microsoft.com/playwright/python:v1.63.0-noble

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Tokyo \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata cron \
    && ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY *.py ./
COPY crontab /etc/cron.d/ig-bsuite
RUN chmod 0644 /etc/cron.d/ig-bsuite \
    && crontab /etc/cron.d/ig-bsuite \
    && touch /var/log/cron.log

CMD ["cron", "-f"]
