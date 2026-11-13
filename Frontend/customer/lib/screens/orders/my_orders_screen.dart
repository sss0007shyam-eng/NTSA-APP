import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/api_client.dart';
import '../../core/app_colors.dart';
import '../../l10n/tr.dart';
import '../../models/order.dart';
import '../../providers/cart_provider.dart';
import '../../widgets/price_tag.dart';
import '../cart/cart_screen.dart';
import 'order_tracking_screen.dart';

class MyOrdersScreen extends StatefulWidget {
  const MyOrdersScreen({super.key});

  @override
  State<MyOrdersScreen> createState() => _MyOrdersScreenState();
}

class _MyOrdersScreenState extends State<MyOrdersScreen> {
  List<Order>? _orders;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_error != null) setState(() => _error = null);
    try {
      final data = await ApiClient.instance.get('/orders') as List;
      if (mounted) setState(() => _orders = data.map((e) => Order.fromJson(e as Map<String, dynamic>)).toList());
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  // Orders whose "Reorder" is in flight, so the button shows a spinner and
  // can't be tapped twice.
  final Set<String> _reordering = {};

  // Put every still-available item from a past order back in the cart, then
  // open the cart. An item that is gone or out of stock is skipped, not fatal.
  Future<void> _reorder(Order order) async {
    setState(() => _reordering.add(order.id));
    final cart = context.read<CartProvider>();
    var added = 0;
    for (final item in order.items) {
      final id = item.productId;
      if (id == null || id.isEmpty) continue;
      String? norm(String? v) => (v == null || v.isEmpty) ? null : v;
      try {
        await cart.add(id, size: norm(item.size), color: norm(item.color), grade: norm(item.grade), quantity: item.quantity);
        added++;
      } catch (_) {/* gone or out of stock -- skip it */}
    }
    if (!mounted) return;
    setState(() => _reordering.remove(order.id));
    if (added == 0) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.tr('orders.reorder.unavailable'))));
      return;
    }
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(context.tr('orders.reorder.added'))));
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CartScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final orders = _orders;
    return Scaffold(
      appBar: AppBar(title: Text(context.tr('orders.my.title'))),
      body: SafeArea(
        child: orders == null
            ? Center(
                child: _error == null
                    ? const CircularProgressIndicator()
                    : Column(mainAxisSize: MainAxisSize.min, children: [
                        Padding(padding: const EdgeInsets.symmetric(horizontal: 24), child: Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.danger))),
                        const SizedBox(height: 12),
                        OutlinedButton(onPressed: _load, child: Text(context.tr('common.retry'))),
                      ]),
              )
            : orders.isEmpty
                ? Center(child: Text(context.tr('orders.my.empty'), style: TextStyle(color: AppColors.textMuted)))
                : ListView.separated(
                    padding: const EdgeInsets.all(14),
                    itemCount: orders.length,
                    separatorBuilder: (context, index) => const SizedBox(height: 10),
                    itemBuilder: (context, i) {
                      final order = orders[i];
                      return InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderTrackingScreen(orderId: order.id))).then((_) => _load()),
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text('#${order.id.substring(0, order.id.length.clamp(0, 10)).toUpperCase()}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                                  _StatusBadge(status: order.status),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text(order.items.map((i) => i.name).join(', '), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5)),
                              // A failed attempt or a parcel on its way back matters more than
                              // the order's own status, so it gets its own line here.
                              if (order.events.isNotEmpty && order.events.last.isProblem) ...[
                                const SizedBox(height: 6),
                                Row(children: [
                                  const Icon(Icons.error_outline_rounded, size: 15, color: AppColors.danger),
                                  const SizedBox(width: 5),
                                  Expanded(child: Text(context.tr(_problemKeys[order.events.last.status] ?? 'sup.ev.delivery_failed'), style: const TextStyle(color: AppColors.danger, fontSize: 12.5, fontWeight: FontWeight.w600))),
                                ]),
                              ],
                              const SizedBox(height: 6),
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  PriceTag(pricePaise: order.totalPaise, size: 14),
                                  TextButton.icon(
                                    onPressed: _reordering.contains(order.id) ? null : () => _reorder(order),
                                    icon: _reordering.contains(order.id)
                                        ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                                        : const Icon(Icons.refresh_rounded, size: 17),
                                    label: Text(context.tr('orders.reorder')),
                                    style: TextButton.styleFrom(foregroundColor: AppColors.orange, padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4), minimumSize: Size.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                                  ),
                                ],
                              ),
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

const _problemKeys = {
  'DELIVERY_FAILED': 'sup.ev.delivery_failed',
  'RTO_INITIATED': 'sup.ev.rto_initiated',
  'RTO_DELIVERED': 'sup.ev.rto_delivered',
  'ISSUE_REPORTED': 'sup.ev.issue_reported',
};

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = status == 'DELIVERED'
        ? AppColors.success
        : status == 'CANCELLED'
            ? AppColors.danger
            : AppColors.orange;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
      child: Text(orderStatusLabel(context, status).toUpperCase(), style: TextStyle(color: color, fontSize: 10.5, fontWeight: FontWeight.w700)),
    );
  }
}
