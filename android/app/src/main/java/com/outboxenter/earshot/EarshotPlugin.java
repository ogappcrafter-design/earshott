package com.outboxenter.earshot;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

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
        p.notifyListeners("state", o);
    }

    /** Starts the background service (quiet notification with Record / Stop). Needs mic permission first. */
    @PluginMethod
    public void start(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
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
}
