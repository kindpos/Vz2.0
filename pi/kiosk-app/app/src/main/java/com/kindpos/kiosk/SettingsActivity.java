package com.kindpos.kiosk;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;

public class SettingsActivity extends Activity {

    private static final String PREFS_NAME = "KINDposPrefs";
    private static final String KEY_URL = "pi_url";
    private static final String DEFAULT_URL = "http://192.168.50.1:8000/terminal/";

    private EditText urlInput;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        urlInput = (EditText) findViewById(R.id.url_input);
        Button saveButton = (Button) findViewById(R.id.save_button);

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        urlInput.setText(prefs.getString(KEY_URL, DEFAULT_URL));

        saveButton.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String url = urlInput.getText().toString().trim();
                if (!url.isEmpty()) {
                    SharedPreferences.Editor editor =
                        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit();
                    editor.putString(KEY_URL, url);
                    editor.apply();
                }
                finish();
            }
        });
    }

    @Override
    public void onBackPressed() {
        // Must tap Save to exit — no back button
    }
}
