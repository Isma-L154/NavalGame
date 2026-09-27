from urllib.parse import urlparse

from workers import Response, WorkerEntrypoint

from naval.worker.headers import API_HEADERS


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        if urlparse(request.url).path == "/api/health":
            return Response.json({"status": "ok"}, headers=dict(API_HEADERS))
        return Response.json({"error": "not_found"}, status=404, headers=dict(API_HEADERS))
