sap.ui.define(["sap/ui/core/Core"], function (Core) {
  "use strict";
  Promise.all([
    Core.loadLibrary("sap.m",          { async: true }),
    Core.loadLibrary("sap.f",          { async: true }),
    Core.loadLibrary("sap.ui.layout",  { async: true })
  ]).then(function () {
    sap.ui.require(["sap/ui/core/ComponentContainer"],
      function (ComponentContainer) {
        new ComponentContainer({
          name: "bid.pilot.dashboard",
          height: "100%",
          async: true
        }).placeAt("content");
      }
    );
  }).catch(function (err) {
    console.error("Library load failed:", err);
  });
});
