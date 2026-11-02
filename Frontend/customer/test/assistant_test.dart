import 'package:flutter_test/flutter_test.dart';
import 'package:ntsa_customer/l10n/app_strings.dart';
import 'package:ntsa_customer/models/assistant_reply.dart';
import 'package:ntsa_customer/widgets/price_tag.dart';

/// The bits line the assistant screen shows above its results. Kept in step
/// with _summaryFor() in screens/assistant/ai_assistant_screen.dart, which
/// reads the shopper's language out of the widget tree instead of a code.
String summaryFor(String lang, AssistantReply reply) {
  final bits = [...reply.labelParts];
  final min = reply.minRupees, max = reply.maxRupees;
  if (min != null && max != null) {
    bits.add('${formatPaise(min * 100)}–${formatPaise(max * 100)}');
  } else if (max != null) {
    bits.add(AppStrings.lookup(lang, 'ai.price_under', {'amount': formatPaise(max * 100)}));
  } else if (min != null) {
    bits.add(AppStrings.lookup(lang, 'ai.price_above', {'amount': formatPaise(min * 100)}));
  }
  return bits.join(' · ');
}

void main() {
  // The reply the backend sends for the client's own example query,
  // "mujhe white jute lene hain aur 1500 ka mera budget hai".
  Map<String, dynamic> reply({String? relaxed, Map<String, dynamic>? understood, List products = const []}) => {
        'query': 'mujhe white jute lene hain aur 1500 ka mera budget hai',
        'summary': 'White · Shoes · under ₹1,500',
        'understood': {'color': 'White', 'item': 'Shoes', 'category': null, 'minRupees': null, 'maxRupees': 1500, 'keywords': [], ...?understood},
        'relaxed': relaxed,
        'products': products,
      };

  test('the reply keeps how the sentence was read, and the products found', () {
    final parsed = AssistantReply.fromJson(reply(products: [
      {'id': 'p1', 'name': 'Canvas Shoes', 'description': '', 'pricePaise': 99900, 'stock': 5, 'images': [], 'deal': false},
    ]));
    expect(parsed.color, 'White');
    expect(parsed.item, 'Shoes');
    expect(parsed.maxRupees, 1500);
    expect(parsed.minRupees, isNull);
    expect(parsed.relaxed, isNull);
    expect(parsed.foundNothing, isFalse);
    expect(parsed.products.single.id, 'p1');
    expect(parsed.labelParts, ['White', 'Shoes']);
  });

  test('the reading is shown back in the shopper\'s own language', () {
    final parsed = AssistantReply.fromJson(reply());
    expect(summaryFor('en', parsed), 'White · Shoes · under ₹1500');
    // Hindi has its own wording for the budget; the colour and the kind of
    // thing come from the catalog and stay as the catalog spells them.
    expect(summaryFor('hi', parsed), 'White · Shoes · ₹1500 से कम');
  });

  test('a price range and leftover words both make it into the line', () {
    final parsed = AssistantReply.fromJson(reply(understood: {
      'color': null, 'item': 'Headphones', 'minRupees': 500, 'maxRupees': 2000, 'keywords': ['boat'],
    }));
    expect(summaryFor('en', parsed), 'Headphones · boat · ₹500–₹2000');
  });

  test('a category stands in when no single kind of thing was named', () {
    final parsed = AssistantReply.fromJson(reply(understood: {'color': null, 'item': null, 'category': 'Fashion', 'maxRupees': null}));
    expect(parsed.labelParts, ['Fashion']);
  });

  test('nothing found is recognised whether the server says so or just sends none', () {
    expect(AssistantReply.fromJson(reply(relaxed: 'none')).foundNothing, isTrue);
    expect(AssistantReply.fromJson(reply(relaxed: 'budget')).foundNothing, isTrue, reason: 'no products is nothing found');
  });

  test('a loosened constraint has a message of its own in every language', () {
    for (final key in ['ai.over_budget', 'ai.relaxed_all']) {
      for (final lang in ['en', 'hi', 'ta', 'fr']) {
        final text = AppStrings.lookup(lang, key, {'bits': 'White · Shoes'});
        expect(text, isNot(key), reason: '$key is missing in $lang');
        expect(text, contains('White · Shoes'), reason: '$key in $lang must show what was searched for');
      }
    }
  });
}
