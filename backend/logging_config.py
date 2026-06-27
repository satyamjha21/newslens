import json
import logging
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "module": record.name,
        }
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)
        extra = getattr(record, "extra_data", None)
        if extra:
            log_entry.update(extra)
        return json.dumps(log_entry, default=str)


def setup_logging(level: str = "INFO") -> logging.Logger:
    root = logging.getLogger()
    if root.handlers:
        return logging.getLogger("newslens")

    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root.addHandler(handler)
    return logging.getLogger("newslens")


def log_event(logger: logging.Logger, message: str, **extra) -> None:
    record = logger.makeRecord(
        logger.name,
        logging.INFO,
        "(unknown)",
        0,
        message,
        (),
        None,
    )
    record.extra_data = extra
    logger.handle(record)
