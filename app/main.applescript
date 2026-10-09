-- GOCO launcher applet.
-- Starts the bundled Node.js server (it hands itself over to launchd and the
-- first process exits right away) and opens the web UI in the default browser.
-- Keep the port in sync with PORT in src/goco-standalone.js.
on run
	set appPath to POSIX path of (path to me)
	set nodeBin to appPath & "Contents/Resources/node"
	set serverScript to appPath & "Contents/Resources/Scripts/goco-standalone.js"
	do shell script (quoted form of nodeBin) & " " & (quoted form of serverScript) & " >/dev/null 2>&1 &"
	delay 2
	open location "http://localhost:3457"
end run
