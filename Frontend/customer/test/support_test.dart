import 'package:flutter_test/flutter_test.dart';
import 'package:ntsa_customer/models/order.dart';
import 'package:ntsa_customer/screens/orders/delivery_updates.dart';
import 'package:ntsa_customer/services/support_api.dart';

void main() {
  test('an order carries its courier, tracking number and journey', () {
    final order = Order.fromJson({
      'id': 'abc123', 'status': 'OUT_FOR_DELIVERY', 'totalPaise': 49900, 'items': [], 'createdAt': '2026-10-20T10:00:00.000Z',
      'courierName': 'Delhivery', 'trackingNumber': 'AWB123', 'trackingUrl': 'https://example.com/AWB123',
      'events': [
        {'id': 'e1', 'status': 'PICKED_UP', 'title': 'Picked up by the courier', 'location': 'Jaipur', 'occurredAt': '2026-10-21T06:00:00.000Z'},
        {'id': 'e2', 'status': 'DELIVERY_FAILED', 'title': 'Delivery attempt failed', 'occurredAt': '2026-10-22T06:00:00.000Z'},
      ],
    });
    expect(order.courierName, 'Delhivery');
    expect(order.trackingNumber, 'AWB123');
    expect(order.events, hasLength(2));
    expect(order.events.first.location, 'Jaipur');
    expect(order.events.first.isProblem, isFalse);
    expect(order.events.last.isProblem, isTrue, reason: 'a failed attempt must stand out to the shopper');
  });

  test('an order with no courier yet parses with empty tracking', () {
    final order = Order.fromJson({'id': 'x', 'status': 'PLACED', 'totalPaise': 100, 'items': [], 'createdAt': '2026-10-20T10:00:00.000Z'});
    expect(order.courierName, isNull);
    expect(order.events, isEmpty);
  });

  test('which problems a shopper can report depends on how far the order got', () {
    kinds(String status) => problemKindsFor(status).map((k) => k.$1).toList();
    expect(kinds('PLACED'), ['OTHER'], reason: 'nothing has shipped yet');
    expect(kinds('SHIPPED'), containsAll(['NOT_RECEIVED', 'OTHER']));
    expect(kinds('SHIPPED'), isNot(contains('DAMAGED')));
    expect(kinds('DELIVERED'), containsAll(['NOT_RECEIVED', 'DAMAGED', 'WRONG_ITEM', 'OTHER']));
  });

  test('a ticket keeps the order it is about, and who said what', () {
    final ticket = SupportTicket.fromJson({
      'id': 't1', 'kind': 'NOT_RECEIVED', 'subject': 'Order #ABC: Not received', 'status': 'OPEN', 'orderId': 'abc123',
      'updatedAt': '2026-10-23T10:00:00.000Z',
      'order': {'id': 'abc123', 'status': 'DELIVERED', 'courierName': 'Delhivery', 'trackingNumber': 'AWB123'},
      'messages': [
        {'sender': 'CUSTOMER', 'name': 'Asha', 'body': 'Not received', 'at': '2026-10-23T09:00:00.000Z'},
        {'sender': 'SUPPORT', 'name': 'Ravi', 'body': 'Checking with the courier', 'at': '2026-10-23T10:00:00.000Z'},
      ],
    });
    expect(ticket.resolved, isFalse);
    expect(ticket.courierName, 'Delhivery');
    expect(ticket.messages.first.fromCustomer, isTrue);
    expect(ticket.messages.last.fromCustomer, isFalse, reason: 'support replies sit on the other side of the chat');
  });
}
