@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PORT=4173
echo.
echo ====================================================
echo   PopRoom Official Website Preview Server
echo   URL: http://127.0.0.1:%PORT%/index.html
echo   Press Ctrl+C to stop the server.
echo ====================================================
echo.
start "" "http://127.0.0.1:%PORT%/index.html"
node -e "const http=require('http'),fs=require('fs'),path=require('path');const m={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.json':'application/json; charset=utf-8','.woff2':'font/woff2'};const root=process.cwd();http.createServer((req,res)=>{let p=decodeURIComponent((req.url||'/').split('?')[0]);if(p==='/')p='/index.html';const full=path.resolve(root,'.'+p);if(!full.startsWith(root)||!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':m[path.extname(full).toLowerCase()]||'application/octet-stream'});fs.createReadStream(full).pipe(res);}).listen(4173,'127.0.0.1');"
