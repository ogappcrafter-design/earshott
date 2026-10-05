package com.outboxenter.earshot;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.io.File;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Keeps Earshot alive with a quiet notification (Record / Stop) and records the microphone
 * natively, so recording works with the app closed, the screen off, or other apps in front.
 */
public class EarshotService extends Service {
    public static final String A_RUN = "com.outboxenter.earshot.RUN";
    public static final String A_REC = "com.outboxenter.earshot.REC";
    public static final String A_STOP = "com.outboxenter.earshot.STOP";
    private static final String CHANNEL = "earshot_quiet";
    private static final int NOTE_ID = 4107;
    private static final int RATE = 48000;
    private static final float GAIN = 3.0f; // about +9.5 dB, hard-limited

    static volatile boolean alive = false;
    static volatile boolean recording = false;

    private volatile boolean keepRecording = false;
    private Thread worker;
    private PowerManager.WakeLock wakeLock;
    private long startedAtMs = 0;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        alive = true;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        createChannel();
        try {
            goForeground();
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (A_REC.equals(action)) {
            startRecording();
        } else if (A_STOP.equals(action)) {
            if (recording) {
                keepRecording = false; // the recording thread finishes the file and updates the notification
            } else {
                stopSelf(); // Stop while idle closes the service and removes the notification
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        keepRecording = false;
        releaseWakeLock();
        alive = false;
        super.onDestroy();
    }

    private void goForeground() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= 30) {
            startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            startForeground(NOTE_ID, n);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Earshot background", NotificationManager.IMPORTANCE_MIN);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.enableLights(false);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private PendingIntent actionIntent(String action, int code) {
        Intent i = new Intent(this, EarshotService.class).setAction(action);
        int flags = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 26) return PendingIntent.getForegroundService(this, code, i, flags);
        return PendingIntent.getService(this, code, i, flags);
    }

    private Notification buildNotification() {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_earshot)
                .setContentTitle("Earshot")
                .setContentText(recording ? "Recording" : "Ready")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(openPi)
                .addAction(0, "Record", actionIntent(A_REC, 1))
                .addAction(0, "Stop", actionIntent(A_STOP, 2));
        if (recording) {
            b.setUsesChronometer(true).setWhen(startedAtMs).setShowWhen(true);
        }
        return b.build();
    }

    private void refreshNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTE_ID, buildNotification());
    }

    private void startRecording() {
        if (recording) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return;
        startedAtMs = System.currentTimeMillis();
        recording = true;
        keepRecording = true;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "earshot:recording");
            wakeLock.acquire(12L * 60L * 60L * 1000L);
        }
        worker = new Thread(this::recordLoop, "earshot-record");
        worker.start();
        refreshNotification();
        EarshotPlugin.emitState(true);
    }

    private void recordLoop() {
        File dir = new File(getFilesDir(), "background");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File part = new File(dir, startedAtMs + ".wav.part");
        File done = new File(dir, startedAtMs + ".wav");
        AudioRecord rec = null;
        RandomAccessFile raf = null;
        long bytesWritten = 0;
        try {
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            int bufBytes = Math.max(min, RATE * 2) * 2;
            rec = new AudioRecord(MediaRecorder.AudioSource.MIC, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufBytes);
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Microphone is busy");
            raf = new RandomAccessFile(part, "rw");
            raf.write(new byte[44]); // header is filled in at the end
            rec.startRecording();
            short[] samples = new short[4096];
            byte[] out = new byte[samples.length * 2];
            while (keepRecording) {
                int n = rec.read(samples, 0, samples.length);
                if (n < 0) break;
                for (int i = 0; i < n; i++) {
                    int v = Math.round(samples[i] * GAIN);
                    if (v > 32767) v = 32767;
                    if (v < -32768) v = -32768;
                    out[2 * i] = (byte) (v & 0xFF);
                    out[2 * i + 1] = (byte) ((v >> 8) & 0xFF);
                }
                raf.write(out, 0, n * 2);
                bytesWritten += n * 2L;
            }
            rec.stop();
            raf.seek(0);
            raf.write(wavHeader(bytesWritten));
        } catch (Exception ignored) {
            // whatever was written so far is still kept below
            try {
                if (raf != null) {
                    raf.seek(0);
                    raf.write(wavHeader(bytesWritten));
                }
            } catch (Exception ignoredAgain) {
                // nothing more we can do
            }
        } finally {
            try {
                if (rec != null) rec.release();
            } catch (Exception ignored) {
                // ignore
            }
            try {
                if (raf != null) raf.close();
            } catch (Exception ignored) {
                // ignore
            }
        }
        if (bytesWritten >= RATE) { // keep anything over half a second
            //noinspection ResultOfMethodCallIgnored
            part.renameTo(done);
        } else {
            //noinspection ResultOfMethodCallIgnored
            part.delete();
        }
        recording = false;
        keepRecording = false;
        releaseWakeLock();
        refreshNotification();
        EarshotPlugin.emitState(false);
    }

    private byte[] wavHeader(long dataBytes) {
        ByteBuffer h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        h.put(new byte[]{'R', 'I', 'F', 'F'});
        h.putInt((int) (36 + dataBytes));
        h.put(new byte[]{'W', 'A', 'V', 'E', 'f', 'm', 't', ' '});
        h.putInt(16);
        h.putShort((short) 1);        // PCM
        h.putShort((short) 1);        // mono
        h.putInt(RATE);
        h.putInt(RATE * 2);           // byte rate
        h.putShort((short) 2);        // block align
        h.putShort((short) 16);       // bits per sample
        h.put(new byte[]{'d', 'a', 't', 'a'});
        h.putInt((int) dataBytes);
        return h.array();
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
            // ignore
        }
        wakeLock = null;
    }
}
