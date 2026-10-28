// getToken/onTokenRefresh/deleteToken are marked deprecated in favour of
// register()/onRegistered, but those hand out a Firebase Installation ID, not
// the FCM registration token the Backend sends to (firebase-admin send({token})),
// so the classic calls stay until the Backend is moved over too.
// ignore_for_file: deprecated_member_use
import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../main.dart' show scaffoldMessengerKey;

/// Push notifications (order updates, delivery OTP). Android only, like the
/// phone sign-in: the web build has no Firebase config and skips all of this.
///
/// The phone's FCM token is saved on the signed-in customer (PATCH /me) so the
/// Backend can push to it. While the app is closed Android shows the push by
/// itself; while it's open we show it as a banner here.
class PushService {
  PushService._();
  static final instance = PushService._();

  StreamSubscription<String>? _refresh;
  StreamSubscription<RemoteMessage>? _foreground;

  bool get _ready => !kIsWeb && Firebase.apps.isNotEmpty;

  /// Call after a customer signs in or their session is restored. Never throws:
  /// a push problem must not get in the way of signing in.
  Future<void> register() async {
    if (!_ready) return;
    try {
      final messaging = FirebaseMessaging.instance;
      // Android 13+ asks the shopper for permission here; older versions grant it.
      final settings = await messaging.requestPermission();
      if (settings.authorizationStatus == AuthorizationStatus.denied) return;
      final token = await messaging.getToken();
      if (token != null) await _save(token);
      _refresh ??= messaging.onTokenRefresh.listen(_save);
      _foreground ??= FirebaseMessaging.onMessage.listen(_showBanner);
    } catch (e) {
      debugPrint('Push setup skipped: $e');
    }
  }

  /// Call before signing out, so this phone stops getting that customer's pushes.
  Future<void> unregister() async {
    if (!_ready) return;
    try {
      await ApiClient.instance.patch('/me', data: {'fcmToken': null});
      await _refresh?.cancel();
      await _foreground?.cancel();
      _refresh = null;
      _foreground = null;
      await FirebaseMessaging.instance.deleteToken();
    } catch (e) {
      debugPrint('Push cleanup skipped: $e');
    }
  }

  Future<void> _save(String token) async {
    try {
      await ApiClient.instance.patch('/me', data: {'fcmToken': token});
    } catch (e) {
      debugPrint('Could not save push token: $e');
    }
  }

  void _showBanner(RemoteMessage message) {
    final n = message.notification;
    if (n == null) return;
    final text = [if (n.title != null) n.title!, if (n.body != null) n.body!].join('\n');
    scaffoldMessengerKey.currentState?.showSnackBar(SnackBar(content: Text(text), duration: const Duration(seconds: 6)));
  }
}
