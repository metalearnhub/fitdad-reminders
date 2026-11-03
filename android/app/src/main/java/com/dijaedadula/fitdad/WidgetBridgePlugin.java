package com.dijaedadula.fitdad;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Lets the web app refresh the home-screen widget right after it saves data. */
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    @PluginMethod
    public void refresh(PluginCall call) {
        FitDadWidget.updateAll(getContext());
        call.resolve(new JSObject());
    }
}
