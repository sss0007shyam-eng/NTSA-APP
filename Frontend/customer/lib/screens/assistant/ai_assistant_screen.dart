import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/app_colors.dart';
import '../../models/assistant_reply.dart';
import '../../models/product.dart';
import '../../providers/shop_provider.dart';
import '../../widgets/app_network_image.dart';
import '../../widgets/price_tag.dart';
import '../products/product_details_screen.dart';
import '../../l10n/tr.dart';

/// The shopping assistant: the shopper describes what they want in their own
/// words ("mujhe white jute lene hain aur 1500 ka mera budget hai") and gets
/// real catalog products back.
///
/// The sentence is read on the server (POST /products/assist, backed by
/// Backend/src/lib/shopQuery.js), which also sends back how it read it --
/// colour, item, budget. That reading is shown above the results, because the
/// one thing a parser does worse than a person is guess what an unfamiliar
/// word means, and a shopper who can see the guess can correct it. No
/// language model is involved, and nothing here invents a product: every card
/// below came out of a catalog query.
class AiAssistantScreen extends StatefulWidget {
  const AiAssistantScreen({super.key});

  @override
  State<AiAssistantScreen> createState() => _AiAssistantScreenState();
}

class _ChatMessage {
  _ChatMessage.user(this.text) : isUser = true, products = null, textKey = null, textArgs = null;
  _ChatMessage.bot({this.textKey, this.textArgs, this.products}) : isUser = false, text = null;

  final bool isUser;
  final String? text;
  /// Bot messages keep a translation key (+ args) and are translated when drawn.
  final String? textKey;
  final Map<String, String>? textArgs;
  final List<Product>? products;
}

/// How the server's reading of the sentence reads back to this shopper, in
/// their own language: "White · Shoes · under ₹1500". The parts themselves
/// (colour names, item kinds) come from the catalog and stay in English, the
/// same as category names everywhere else in the app.
String _summaryFor(BuildContext context, AssistantReply reply) {
  final bits = [...reply.labelParts];
  final min = reply.minRupees, max = reply.maxRupees;
  if (min != null && max != null) {
    bits.add('${formatPaise(min * 100)}–${formatPaise(max * 100)}');
  } else if (max != null) {
    bits.add(context.tr('ai.price_under', {'amount': formatPaise(max * 100)}));
  } else if (min != null) {
    bits.add(context.tr('ai.price_above', {'amount': formatPaise(min * 100)}));
  }
  return bits.join(' · ');
}

class _AiAssistantScreenState extends State<AiAssistantScreen> {
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  final List<_ChatMessage> _messages = [
    _ChatMessage.bot(textKey: 'ai.greeting'),
  ];
  bool _loading = false;

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    });
  }

  Future<void> _send(String raw) async {
    final query = raw.trim();
    if (query.isEmpty || _loading) return;
    _controller.clear();
    final shop = context.read<ShopProvider>();
    setState(() {
      _messages.add(_ChatMessage.user(query));
      _loading = true;
    });
    _scrollToEnd();
    try {
      final reply = await shop.assistantSearch(query);
      if (!mounted) return;
      setState(() => _messages.add(_botReplyFor(reply)));
    } catch (e) {
      if (mounted) setState(() => _messages.add(_ChatMessage.bot(textKey: 'ai.error')));
    } finally {
      if (mounted) {
        setState(() => _loading = false);
        _scrollToEnd();
      }
    }
  }

  /// One bot bubble for a reply. When a constraint had to be dropped to find
  /// anything, the bubble says which -- an unexplained shelf of the wrong
  /// colour or price is worse than no results.
  _ChatMessage _botReplyFor(AssistantReply reply) {
    if (reply.foundNothing) return _ChatMessage.bot(textKey: 'ai.not_found');
    final bits = _summaryFor(context, reply);
    final String key;
    Map<String, String>? args;
    switch (reply.relaxed) {
      case 'color' when reply.color != null:
        key = 'ai.color_missed';
        args = {'color': reply.color!};
      case 'budget':
        key = 'ai.over_budget';
        args = {'bits': bits};
      case 'all':
        key = 'ai.relaxed_all';
        args = {'bits': bits};
      default:
        key = bits.isEmpty ? 'ai.found' : 'ai.found_for';
        args = bits.isEmpty ? null : {'bits': bits};
    }
    return _ChatMessage.bot(textKey: key, textArgs: args, products: reply.products);
  }

  @override
  void dispose() {
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.manage_search_rounded, color: AppColors.orange, size: 22),
            const SizedBox(width: 8),
            Text(context.tr('ai.title')),
          ],
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: ListView.builder(
                controller: _scroll,
                padding: const EdgeInsets.all(14),
                itemCount: _messages.length + (_loading ? 1 : 0),
                itemBuilder: (context, i) {
                  if (i == _messages.length) {
                    return const Align(alignment: Alignment.centerLeft, child: Padding(padding: EdgeInsets.symmetric(vertical: 8), child: SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))));
                  }
                  final m = _messages[i];
                  if (m.isUser) {
                    return Align(
                      alignment: Alignment.centerRight,
                      child: Container(
                        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
                        margin: const EdgeInsets.symmetric(vertical: 5),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(color: AppColors.navy, borderRadius: BorderRadius.circular(14)),
                        child: Text(m.text ?? '', style: const TextStyle(color: Colors.white, fontSize: 13.5)),
                      ),
                    );
                  }
                  return Align(
                    alignment: Alignment.centerLeft,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (m.text != null || m.textKey != null)
                          Container(
                            constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
                            margin: const EdgeInsets.symmetric(vertical: 5),
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                            decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: AppColors.border)),
                            child: Text(m.textKey != null ? context.tr(m.textKey!, m.textArgs) : m.text!, style: TextStyle(color: AppColors.textPrimary, fontSize: 13.5)),
                          ),
                        if (m.products != null)
                          SizedBox(
                            height: 190,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: m.products!.length,
                              separatorBuilder: (context, i) => const SizedBox(width: 10),
                              itemBuilder: (context, i) => _AssistantProductCard(product: m.products![i]),
                            ),
                          ),
                      ],
                    ),
                  );
                },
              ),
            ),
            SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        decoration: InputDecoration(hintText: context.tr('ai.hint')),
                        onSubmitted: _send,
                      ),
                    ),
                    const SizedBox(width: 8),
                    IconButton.filled(
                      onPressed: _loading ? null : () => _send(_controller.text),
                      style: IconButton.styleFrom(backgroundColor: AppColors.orange),
                      icon: const Icon(Icons.send_rounded, color: Colors.white),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AssistantProductCard extends StatelessWidget {
  const _AssistantProductCard({required this.product});
  final Product product;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductDetailsScreen(productId: product.id))),
      child: Container(
        width: 130,
        decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12), border: Border.all(color: AppColors.border)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
                child: SizedBox.expand(
                  child: product.image.isEmpty
                      ? Container(color: AppColors.background, child: Icon(Icons.image_outlined, color: AppColors.textMuted))
                      : AppNetworkImage(product.image, fit: BoxFit.cover),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(product.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 11.5)),
                  const SizedBox(height: 3),
                  PriceTag(pricePaise: product.pricePaise, mrpPaise: product.mrpPaise, size: 12.5),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
