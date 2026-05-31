; 覆盖默认固实压缩（/SOLID lzma）为非固实压缩
; 固实压缩会导致小改动也触发大范围 blockmap 差异，差量更新失效
; 非固实压缩安装包会增大 ~20%，但日常差量更新只需下载几 MB
SetCompressor lzma
