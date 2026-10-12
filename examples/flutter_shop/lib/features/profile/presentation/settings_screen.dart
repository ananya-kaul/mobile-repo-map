import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:flutter_shop/core/utils/formatters.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  static const privacyPolicyUrl = 'https://flutter-shop.dev/privacy';

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  static const _pushKey = 'settings.push_enabled';
  static const _currencyKey = 'settings.currency';

  bool _pushEnabled = true;
  String _currency = 'USD';

  @override
  void initState() {
    super.initState();
    SharedPreferences.getInstance().then((prefs) {
      if (!mounted) return;
      setState(() {
        _pushEnabled = prefs.getBool(_pushKey) ?? true;
        _currency = prefs.getString(_currencyKey) ?? 'USD';
      });
    });
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_pushKey, _pushEnabled);
    await prefs.setString(_currencyKey, _currency);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          SwitchListTile(
            title: const Text('Order notifications'),
            value: _pushEnabled,
            onChanged: (v) {
              setState(() => _pushEnabled = v);
              _save();
            },
          ),
          ListTile(
            title: const Text('Currency'),
            subtitle: Text('Prices look like ${Formatters.price(1234.5, currency: _currency)}'),
            trailing: DropdownButton<String>(
              value: _currency,
              items: const [
                DropdownMenuItem(value: 'USD', child: Text('USD')),
                DropdownMenuItem(value: 'EUR', child: Text('EUR')),
                DropdownMenuItem(value: 'GBP', child: Text('GBP')),
              ],
              onChanged: (v) {
                if (v == null) return;
                setState(() => _currency = v);
                _save();
              },
            ),
          ),
          ListTile(
            title: const Text('Privacy policy'),
            subtitle: const Text(SettingsScreen.privacyPolicyUrl),
            trailing: const Icon(Icons.copy),
            onTap: () async {
              await Clipboard.setData(const ClipboardData(text: SettingsScreen.privacyPolicyUrl));
              if (!context.mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Link copied')),
              );
            },
          ),
          const AboutListTile(applicationName: 'Flutter Shop', applicationVersion: '1.4.0'),
        ],
      ),
    );
  }
}
