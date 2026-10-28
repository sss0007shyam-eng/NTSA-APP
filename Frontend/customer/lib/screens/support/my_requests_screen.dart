import 'package:flutter/material.dart';
import '../../core/app_colors.dart';
import '../../l10n/tr.dart';
import '../../services/support_api.dart';
import 'ticket_screen.dart';

/// Every support request the shopper has opened about an order, newest first.
class MyRequestsScreen extends StatefulWidget {
  const MyRequestsScreen({super.key});

  @override
  State<MyRequestsScreen> createState() => _MyRequestsScreenState();
}

class _MyRequestsScreenState extends State<MyRequestsScreen> {
  List<SupportTicket>? _tickets;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final t = await SupportApi.mine();
      if (mounted) {
        setState(() {
          _tickets = t;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final tickets = _tickets;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('sup.requests.title'))),
      body: tickets == null
          ? Center(child: _error == null ? const CircularProgressIndicator() : Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
              Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.danger)),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _load, child: Text(context.tr('common.retry'))),
            ])))
          : RefreshIndicator(
              onRefresh: _load,
              child: tickets.isEmpty
                  ? ListView(children: [Padding(padding: const EdgeInsets.all(40), child: Text(context.tr('sup.requests.empty'), textAlign: TextAlign.center, style: TextStyle(color: AppColors.textMuted)))])
                  : ListView.separated(
                      padding: const EdgeInsets.all(14),
                      itemCount: tickets.length,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (context, i) {
                        final t = tickets[i];
                        final last = t.messages.isEmpty ? '' : t.messages.last.body;
                        return InkWell(
                          borderRadius: BorderRadius.circular(14),
                          onTap: () async {
                            await Navigator.of(context).push(MaterialPageRoute(builder: (_) => TicketScreen(ticketId: t.id)));
                            _load();
                          },
                          child: Container(
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(border: Border.all(color: AppColors.border), borderRadius: BorderRadius.circular(14)),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(children: [
                                  Expanded(child: Text(t.subject, style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                    decoration: BoxDecoration(color: (t.resolved ? AppColors.success : AppColors.orange).withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
                                    child: Text(context.tr(t.resolved ? 'sup.requests.resolved' : 'sup.requests.open'), style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: t.resolved ? AppColors.success : AppColors.orange)),
                                  ),
                                ]),
                                const SizedBox(height: 4),
                                Text(last, maxLines: 2, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}
