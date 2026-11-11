package com.outboxenter.earshot;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

@CapacitorPlugin(name = "Earshot")
public class EarshotPlugin extends Plugin {
    private static EarshotPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    static void emitState(boolean recording) {
        EarshotPlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put("recording", recording);
        // Called from the recording thread: hand it to the main thread before touching the WebView bridge
        new Handler(Looper.getMainLooper()).post(() -> {
            try { p.notifyListeners("state", o); } catch (Exception ignored) { /* app closing */ }
        });
    }

    /** Starts the background service (quiet notification with Record / Stop). Needs mic permission first. */
    @PluginMethod
    public void start(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        if (EarshotService.alive) { // already running: starting it again is pointless and risky on newer Android
            r.put("started", true);
            call.resolve(r);
            return;
        }
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            r.put("started", false);
            r.put("error", "no mic permission yet");
            call.resolve(r);
            return;
        }
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && getActivity() != null) {
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4107);
        }
        try {
            Intent i = new Intent(c, EarshotService.class).setAction(EarshotService.A_RUN);
            ContextCompat.startForegroundService(c, i);
            r.put("started", true);
        } catch (Exception e) {
            r.put("started", false);
            r.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(r);
    }

    /** Finished background recordings waiting to be imported into the archive. */
    @PluginMethod
    public void takeRecordings(PluginCall call) {
        JSArray files = new JSArray();
        File dir = new File(getContext().getFilesDir(), "background");
        File[] list = dir.listFiles((d, name) -> name.endsWith(".wav"));
        if (list != null) {
            for (File f : list) {
                String n = f.getName();
                long startedAt;
                try {
                    startedAt = Long.parseLong(n.substring(0, n.length() - 4));
                } catch (Exception e) {
                    startedAt = f.lastModified();
                }
                JSObject o = new JSObject();
                o.put("name", n);
                o.put("path", f.getAbsolutePath());
                o.put("startedAt", startedAt);
                o.put("bytes", f.length());
                o.put("durationSec", Math.max(0, f.length() - 44) / (48000.0 * 2.0));
                files.put(o);
            }
        }
        JSObject r = new JSObject();
        r.put("files", files);
        r.put("recording", EarshotService.recording);
        call.resolve(r);
    }

    /** Deletes an imported file from the phone. Only plain file names inside our folder are allowed. */
    @PluginMethod
    public void discard(PluginCall call) {
        String name = call.getString("name", "");
        if (name == null || name.isEmpty() || name.contains("/") || name.contains("\\") || name.contains("..")) {
            call.reject("bad name");
            return;
        }
        File f = new File(new File(getContext().getFilesDir(), "background"), name);
        //noinspection ResultOfMethodCallIgnored
        if (f.exists()) f.delete();
        call.resolve();
    }

    /** In-app Record button: the service records, so it keeps going when the app is minimized or the screen locks. */
    @PluginMethod
    public void record(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            r.put("ok", false);
            r.put("error", "Microphone permission is off.");
            call.resolve(r);
            return;
        }
        try {
            ContextCompat.startForegroundService(c, new Intent(c, EarshotService.class).setAction(EarshotService.A_REC));
            r.put("ok", true);
        } catch (Exception e) {
            r.put("ok", false);
            r.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(r);
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        Context c = getContext();
        try {
            if (EarshotService.recording) c.startService(new Intent(c, EarshotService.class).setAction(EarshotService.A_STOP));
        } catch (Exception ignored) { /* already stopped */ }
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("recording", EarshotService.recording);
        r.put("startedAt", EarshotService.startedAtMs);
        call.resolve(r);
    }

    /** Why Android closed the app the last few times (crash, out of memory, killed...), plus any Java crash trace. */
    @PluginMethod
    public void lastExit(PluginCall call) {
        JSObject r = new JSObject();
        JSArray list = new JSArray();
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                List<ApplicationExitInfo> infos = am.getHistoricalProcessExitReasons(null, 0, 4);
                for (ApplicationExitInfo e : infos) {
                    JSObject o = new JSObject();
                    o.put("at", e.getTimestamp());
                    o.put("reason", e.getReason());
                    o.put("status", e.getStatus());
                    o.put("importance", e.getImportance());
                    o.put("process", e.getProcessName());
                    o.put("description", String.valueOf(e.getDescription()));
                    o.put("pssKB", e.getPss());
                    o.put("rssKB", e.getRss());
                    list.put(o);
                }
            } catch (Exception ex) {
                r.put("exitError", String.valueOf(ex));
            }
        }
        r.put("exits", list);
        File f = new File(getContext().getFilesDir(), "last_crash.txt");
        if (f.exists()) {
            try (InputStream in = new FileInputStream(f)) {
                byte[] b = new byte[(int) Math.min(f.length(), 12000)];
                int n = in.read(b);
                r.put("javaCrash", new String(b, 0, Math.max(0, n), StandardCharsets.UTF_8));
            } catch (Exception ignored) { /* unreadable */ }
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        call.resolve(r);
    }
}
