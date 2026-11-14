package app.whereto.business;

import android.os.Bundle;

import app.whereto.business.footprints.NativeFootprintsPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeFootprintsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
