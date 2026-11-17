package com.alejandrodukesini.gestortareas

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Edge-to-edge es obligatorio desde Android 15, pero la WebView no siempre
    // expone las zonas seguras a CSS: la barra inferior de la app quedaba bajo
    // los botones del sistema. Se reserva el espacio aquí, de forma nativa, para
    // las barras del sistema, el recorte de pantalla y el teclado virtual (así
    // el teclado ya no tapa los campos: la WebView se encoge por encima de él).
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or
          WindowInsetsCompat.Type.displayCutout() or
          WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
