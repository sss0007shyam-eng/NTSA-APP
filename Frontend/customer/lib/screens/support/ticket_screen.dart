import 'dart:async';
import 'package:flutter/material.dart';
import '../../core/app_colors.dart';
import '../../l10n/tr.dart';
import '../../services/support_api.dart';
import '../orders/order_tracking_screen.dart';

/// The chat with NTSA support about one order. Support may have been in touch
/// with the delivery team meanwhile; the shopper only sees what support says.
/// Refreshes by itself every 15 seconds while it is open.
class TicketScreen extends StatefulWidget {
  const TicketScreen({super.key, required this.ticketId});

  final String ticketId;

  @override
  State<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends State<TicketScreen> {
  SupportTicket? _ticket;
  String? _error;
  bool _sending = false;
  final _text = TextEditingController();
  final _scroll = ScrollController();
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 15), (_) => _load(quiet: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool quiet = false}) async {
    try {
      final t = await SupportApi.get(widget.ticketId);
      if (!mounted) return;
      final grew = _ticket == null || t.messages.length != _ticket!.messages.length;
      setState(() {
        _ticket = t;
        _error = null;
      });
      if (grew) _toEnd();
    } catch (e) {
      if (mounted && !quiet) setState(() => _error = e.toString());
    }
  }

  void _toEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
      });

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final t = await SupportApi.send(widget.ticketId, body);
      _text.clear();
      if (mounted) setState(() => _ticket = t);
      _toEnd();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = _ticket;
    return Scaffold(
      appBar: AppBar(title: Text(t?.subject ?? context.tr('sup.chat.title'), overflow: TextOverflow.ellipsis)),
      body: t == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Text(_error!, style: const TextStyle(color: AppColors.danger)))
          : SafeArea(
              child: Column(
                children: [
                  if (t.orderId != null) _OrderStrip(ticket: t),
                  Expanded(
                    child: ListView(
                      controller: _scroll,
                      padding: const EdgeInsets.all(14),
                      children: [for (final m in t.messages) _Bubble(message: m)],
                    ),
                  ),
                  if (t.resolved)
                    Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 6), child: Text(context.tr('sup.chat.resolved_note'), textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted, fontSize: 12.5))),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 4, 12, 10),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _text,
                            minLines: 1,
                            maxLines: 4,
                            textInputAction: TextInputAction.send,
                            onSubmitted: (_) => _send(),
                            decoration: InputDecoration(hintText: context.tr('sup.chat.reply_hint'), border: const OutlineInputBorder(), isDense: true),
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton.filled(
                          onPressed: _sending ? null : _send,
                          icon: _sending ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

/// Which order this is about, and where the parcel is, with a way back to it.
class _OrderStrip extends StatelessWidget {
  const _OrderStrip({required this.ticket});

  final SupportTicket ticket;

  @override
  Widget build(BuildContext context) {
    final id = ticket.orderId!;
    final short = id.substring(0, id.length.clamp(0, 10)).toUpperCase();
    return InkWell(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderTrackingScreen(orderId: id))),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        color: AppColors.border.withValues(alpha: 0.35),
        child: Row(
          children: [
            const Icon(Icons.local_shipping_outlined, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(context.tr('sup.chat.order', {'id': short}), style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
                  if (ticket.courierName != null && ticket.trackingNumber != null)
                    Text('${ticket.courierName}  ·  ${ticket.trackingNumber}', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded),
          ],
        ),
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final TicketMessage message;

  @override
  Widget build(BuildContext context) {
    final mine = message.fromCustomer;
    final t = message.at;
    final stamp = '${t.day}/${t.month}  ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    return Align(
      alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        decoration: BoxDecoration(
          color: mine ? AppColors.orange.withValues(alpha: 0.15) : AppColors.border.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(mine ? context.tr('sup.chat.you') : context.tr('sup.chat.support'), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: AppColors.textSecondary)),
            const SizedBox(height: 2),
            Text(message.body),
            const SizedBox(height: 3),
            Text(stamp, style: TextStyle(fontSize: 10.5, color: AppColors.textMuted)),
          ],
        ),
      ),
    );
  }
}
