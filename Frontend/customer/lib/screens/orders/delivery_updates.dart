import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../core/app_colors.dart';
import '../../l10n/tr.dart';
import '../../models/order.dart';
import '../../services/support_api.dart';
import '../../widgets/primary_button.dart';
import '../support/ticket_screen.dart';

const _eventKeys = {
  'PICKED_UP': 'sup.ev.picked_up',
  'IN_TRANSIT': 'sup.ev.in_transit',
  'OUT_FOR_DELIVERY': 'sup.ev.out_for_delivery',
  'DELIVERY_FAILED': 'sup.ev.delivery_failed',
  'DELIVERED': 'sup.ev.delivered',
  'RTO_INITIATED': 'sup.ev.rto_initiated',
  'RTO_DELIVERED': 'sup.ev.rto_delivered',
  'ISSUE_REPORTED': 'sup.ev.issue_reported',
};

String _two(int n) => n.toString().padLeft(2, '0');
String _when(DateTime t) => '${t.day}/${t.month}/${t.year}  ${_two(t.hour)}:${_two(t.minute)}';

/// Who is carrying the order, its tracking number, and every step of its
/// journey, newest first -- the same list the seller and support see.
class DeliveryUpdates extends StatelessWidget {
  const DeliveryUpdates({super.key, required this.order});

  final Order order;

  Future<void> _openTracking(BuildContext context) async {
    final ok = await launchUrl(Uri.parse(order.trackingUrl!), mode: LaunchMode.externalApplication);
    if (!ok && context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.tr('sup.could_not_open'))));
  }

  @override
  Widget build(BuildContext context) {
    final events = order.events.reversed.toList();
    final hasCourier = order.courierName != null && order.trackingNumber != null;
    if (events.isEmpty && !hasCourier) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: 8, bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(context.tr('sup.updates.title'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          if (hasCourier) ...[
            const SizedBox(height: 10),
            Text('${context.tr('sup.courier')}: ${order.courierName}', style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 2),
            Row(children: [
              Flexible(child: Text('${context.tr('sup.tracking_no')}: ${order.trackingNumber}', style: TextStyle(color: AppColors.textSecondary, fontSize: 13))),
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.copy_rounded, size: 17),
                onPressed: () {
                  Clipboard.setData(ClipboardData(text: order.trackingNumber!));
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.tr('sup.copied'))));
                },
              ),
            ]),
            if (order.trackingUrl != null)
              TextButton.icon(
                onPressed: () => _openTracking(context),
                icon: const Icon(Icons.open_in_new_rounded, size: 16),
                label: Text(context.tr('sup.track_on_courier')),
                style: TextButton.styleFrom(padding: EdgeInsets.zero, alignment: Alignment.centerLeft),
              ),
          ],
          const SizedBox(height: 10),
          if (events.isEmpty)
            Text(context.tr('sup.updates.empty'), style: TextStyle(color: AppColors.textMuted, fontSize: 13))
          else
            for (final e in events) _EventRow(event: e),
        ],
      ),
    );
  }
}

class _EventRow extends StatelessWidget {
  const _EventRow({required this.event});

  final ShipmentEvent event;

  @override
  Widget build(BuildContext context) {
    final color = event.isProblem ? AppColors.danger : event.status == 'DELIVERED' ? AppColors.success : AppColors.textPrimary;
    final key = _eventKeys[event.status];
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 5, right: 10), child: Icon(Icons.circle, size: 9, color: color)),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(key != null ? context.tr(key) : event.title, style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5, color: color)),
                Text([if (event.location != null) event.location!, _when(event.at)].join('  ·  '), style: TextStyle(color: AppColors.textMuted, fontSize: 12)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

const _kinds = [
  ('NOT_RECEIVED', 'sup.problem.not_received', Icons.inventory_2_outlined),
  ('DAMAGED', 'sup.problem.damaged', Icons.broken_image_outlined),
  ('WRONG_ITEM', 'sup.problem.wrong_item', Icons.swap_horiz_rounded),
  ('OTHER', 'sup.problem.other', Icons.help_outline_rounded),
];

/// Which problems apply depends on how far the order got: it can only be "not
/// received" once it has shipped, and only damaged or wrong once delivered.
List<(String, String, IconData)> problemKindsFor(String status) => [
      for (final k in _kinds)
        if (k.$1 == 'OTHER' || (k.$1 == 'NOT_RECEIVED' ? const ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'].contains(status) : status == 'DELIVERED')) k,
    ];

/// "Problem with this order?": pick what went wrong, say a few words, and it
/// goes to NTSA support, who chase the delivery team. Opens the chat afterwards.
Future<void> reportProblem(BuildContext context, Order order) async {
  final navigator = Navigator.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final ticket = await showModalBottomSheet<SupportTicket>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
    builder: (sheet) => _ReportSheet(order: order),
  );
  if (ticket == null) return;
  messenger.showSnackBar(SnackBar(content: Text(context.mounted ? context.tr('sup.problem.sent') : '')));
  navigator.push(MaterialPageRoute(builder: (_) => TicketScreen(ticketId: ticket.id)));
}

class _ReportSheet extends StatefulWidget {
  const _ReportSheet({required this.order});

  final Order order;

  @override
  State<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<_ReportSheet> {
  late String _kind = problemKindsFor(widget.order.status).first.$1;
  final _text = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (_text.text.trim().length < 3) {
      setState(() => _error = context.tr('sup.problem.too_short'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final ticket = await SupportApi.reportIssue(widget.order.id, _kind, _text.text.trim());
      if (mounted) Navigator.of(context).pop(ticket);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final kinds = problemKindsFor(widget.order.status);
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 14, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(child: Container(width: 42, height: 4, decoration: BoxDecoration(color: AppColors.border, borderRadius: BorderRadius.circular(2)))),
            const SizedBox(height: 16),
            Text(context.tr('sup.problem.title'), style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            RadioGroup<String>(
              groupValue: _kind,
              onChanged: (v) {
                if (!_busy && v != null) setState(() => _kind = v);
              },
              child: Column(
                children: [
                  for (final k in kinds)
                    RadioListTile<String>(
                      value: k.$1,
                      title: Text(context.tr(k.$2)),
                      secondary: Icon(k.$3),
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            TextField(controller: _text, minLines: 3, maxLines: 5, maxLength: 1000, decoration: InputDecoration(hintText: context.tr('sup.problem.hint'), border: const OutlineInputBorder())),
            if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(color: AppColors.danger, fontSize: 13))),
            PrimaryButton(label: context.tr('sup.problem.send'), orange: true, loading: _busy, onPressed: _send),
          ],
        ),
      ),
    );
  }
}
