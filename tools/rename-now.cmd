@echo off
rem ============================================================================
rem  rename-now.cmd — 把本项目目录改名的包装脚本（本体是 rename-workspace.mjs）
rem
rem  用法：
rem    1) 把下面的 TO_NAME 改成你要的新目录名（这是唯一需要按机器改的一行）；
rem    2) **完全退出 DeepSeek Harness**（托盘图标也要退出）；
rem    3) 双击本文件。脚本会等待 DSH 退出，然后一次做完：改目录名、迁移会话日志的
rem       cwd、更新 workspace.json、合并样式目录、重建 profile 联接、清理悬空残留
rem       与投影缓存。全过程写日志并自动用记事本打开。
rem  续跑：rename-now.cmd "<旧目录>" "<新目录>" 显式指定两端——上一轮只改完名就中断、
rem        本文件已随目录到了新位置时，用这个入口（此时自动推导不出旧路径）。
rem  实测依据：只要有进程的工作目录/打开窗口在该目录内，Windows 就拒绝改名；因此本
rem        脚本先把自己复制到 %TEMP% 分离启动并立即退出父进程，子进程 /D C:\ 工作。
rem  参数传递：两端路径写进旁路 args 文件（内容是两条 set 命令，由副本 call 执行），
rem        不走 start 的命令行——cmd 对 start + 嵌套引号在带参数时会丢参（实测）。
rem  块内展开：cmd 在解析整个 ( ) 块时就展开 %VAR%，所以「set 后立刻用」的变量一律
rem        用 goto 流程放在独立行处理，绝不写进块里（沙箱回归实测踩过这个坑）。
rem ============================================================================
setlocal EnableExtensions

set "TO_NAME=dsh-custom-style"
set "LOG=%TEMP%\dsh-rename-workspace.log"
set "RELAUNCH=%TEMP%\dsh-rename-workspace.cmd"
set "ARGFILE=%TEMP%\dsh-rename-workspace.args"

if /I "%~dp0"=="%TEMP%\" goto :child

rem ---- 父段（原始位置）：确定两端目录 → 复制自身与 args 文件 → 分离启动 ----
if not "%~1"=="" goto :parent-explicit
for %%I in ("%~dp0..") do set "FROM_DIR=%%~fI"
for %%I in ("%FROM_DIR%") do set "PARENT=%%~dpI"
set "TO_DIR=%PARENT%%TO_NAME%"
goto :parent-launch
:parent-explicit
set "FROM_DIR=%~1"
set "TO_DIR=%~2"
:parent-launch
copy /Y "%~f0" "%RELAUNCH%" >nul
>"%ARGFILE%" echo set "FROM_DIR=%FROM_DIR%"
>>"%ARGFILE%" echo set "TO_DIR=%TO_DIR%"
start "dsh-rename" /D C:\ /min cmd /c ""%RELAUNCH%""
exit /b 0

:child
rem ---- 子段（%TEMP% 副本）：args 文件优先，其次显式参数 ----
chcp 65001 >nul
if not exist "%ARGFILE%" goto :child-argv
call "%ARGFILE%"
goto :child-check
:child-argv
if not "%~1"=="" goto :child-argv-use
goto :child-check
:child-argv-use
set "FROM_DIR=%~1"
set "TO_DIR=%~2"
:child-check
if not "%FROM_DIR%"=="" if not "%TO_DIR%"=="" goto :child-go
echo 无法确定旧目录/新目录：缺少 %ARGFILE% 或显式参数。
pause
exit /b 2
:child-go
for %%I in ("%FROM_DIR%") do set "CSS_FROM=%%~nxI"

rem 脚本自身绝不能待在要被改名的目录里（Windows 不允许改名任何进程的当前目录）
cd /d C:\

rem node：优先 PATH 里的 node；否则退回 DSH 自带运行时（用 %USERPROFILE% 而不是写死用户名）
set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

echo [%date% %time%] 等待 DeepSeek Harness 完全退出... > "%LOG%"
echo FROM=%FROM_DIR%  TO=%TO_DIR% >> "%LOG%"
:waitloop
tasklist /FI "IMAGENAME eq DeepSeek Harness.exe" 2>nul | find /I "DeepSeek Harness.exe" >nul
if not errorlevel 1 (
  ping -n 3 127.0.0.1 >nul
  goto waitloop
)
echo [%date% %time%] DSH 已退出，开始改名。 >> "%LOG%"

rem 断点续跑：若上一轮已把目录改名但后续中断，工具本体已在新目录下——从存在的那一侧取。
set "PROJ_DIR=%FROM_DIR%"
if not exist "%FROM_DIR%\tools\rename-workspace.mjs" if exist "%TO_DIR%\tools\rename-workspace.mjs" set "PROJ_DIR=%TO_DIR%"

rem 退出码 6 只有一种含义：目录改不动（被某个进程的 CWD/打开的窗口占用）。
rem 最常见是资源管理器窗口停在该目录（本插件「打开目录」按钮就会开一个）。
rem 等 5 秒重试，最多 3 次；其它退出码不重试。
set "ATTEMPT=0"
:retryloop
set /a ATTEMPT+=1
"%NODE%" "%PROJ_DIR%\tools\rename-workspace.mjs" --from "%FROM_DIR%" --to "%TO_DIR%" --css-from "%CSS_FROM%" --apply >> "%LOG%" 2>&1
set "RC=%ERRORLEVEL%"
if not "%RC%"=="6" goto :finished
if "%ATTEMPT%"=="3" goto :finished
echo [%date% %time%] rename blocked (exit 6) — 改名被占用（第 %ATTEMPT% 次）。若资源管理器正显示该目录，请关掉它的窗口；5 秒后自动重试。 >> "%LOG%"
ping -n 6 127.0.0.1 >nul
goto :retryloop

:finished
echo [%date% %time%] 退出码 %RC% >> "%LOG%"
del "%ARGFILE%" >nul 2>nul
echo.
if "%RC%"=="0" (
  echo 完成。项目目录现在是 %TO_DIR%
  echo 重新打开 DeepSeek Harness，工作区会指向新路径。
) else (
  echo 未成功（退出码 %RC%）。没有破坏任何东西，可重跑本脚本。
)
echo 日志：%LOG%
echo.
notepad "%LOG%"
endlocal
