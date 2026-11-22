import {
  DOCUMENTS_PATH_PREFIX,
  type HocusDeleteRoute,
} from "@/lib/security/hocus-delete-route";
import { isShareHttpPath, type ShareHttp } from "@/lib/sharing/share-http";

/**
 * Plain-HTTP routes in the Hocus process. Each family ships dark: while its
 * flag is off (`HOCUS_SHARES`, `HOCUS_DELETE_ROUTE`) its paths answer 404.
 * Any other path returns null synchronously, so the caller keeps today's
 * health-check answer unchanged.
 */
export function createHocusHttpRoutes(routes: {
  shares: ShareHttp | null;
  deleteDocument: HocusDeleteRoute | null;
}) {
  const notFound = () =>
    new Response("Not found", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });

  return (request: Request, ip: string): Promise<Response> | null => {
    const { pathname } = new URL(request.url);
    if (isShareHttpPath(pathname)) {
      return routes.shares
        ? routes.shares.handle(request, ip)
        : Promise.resolve(notFound());
    }
    if (pathname.startsWith(DOCUMENTS_PATH_PREFIX)) {
      return routes.deleteDocument
        ? routes.deleteDocument.handle(request, ip)
        : Promise.resolve(notFound());
    }
    return null;
  };
}
