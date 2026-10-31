import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/** 极简静态服务器（开发/预览用）：java StaticServer <rootDir> <port> */
public class StaticServer {
    public static void main(String[] args) throws Exception {
        Path root = Paths.get(args[0]).toAbsolutePath().normalize();
        int port = Integer.parseInt(args[1]);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", ex -> {
            String p = ex.getRequestURI().getPath();
            if (p.equals("/")) p = "/index.html";
            try {
                Path f = root.resolve(p.substring(1)).normalize();
                if (!f.startsWith(root) || !Files.isRegularFile(f)) {
                    send(ex, 404, "text/plain; charset=utf-8", ("404 Not Found: " + p).getBytes("UTF-8"));
                    return;
                }
                send(ex, 200, mime(f), Files.readAllBytes(f));
            } catch (Exception e) {
                send(ex, 500, "text/plain; charset=utf-8", e.toString().getBytes("UTF-8"));
            }
            ex.close();
        });
        server.start();
        System.out.println("Serving " + root + " at http://127.0.0.1:" + port + "/");
    }

    static String mime(Path f) {
        String s = f.toString().toLowerCase();
        if (s.endsWith(".html")) return "text/html; charset=utf-8";
        if (s.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (s.endsWith(".css")) return "text/css; charset=utf-8";
        if (s.endsWith(".json")) return "application/json; charset=utf-8";
        if (s.endsWith(".svg")) return "image/svg+xml";
        if (s.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    static void send(HttpExchange ex, int code, String type, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.sendResponseHeaders(code, body.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(body); }
    }
}
