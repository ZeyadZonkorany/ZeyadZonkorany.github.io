---
title: "Digits In, GHOST Out"
description: "A Unicode-aware digit check followed by a byte cast lets dnsjava accept an X.25 address that serializes as different ASCII text."
date: 2026-10-25
category: Research
cover: x25
source:
  url: https://github.com/dnsjava/dnsjava/security/advisories/GHSA-whp4-9hfm-h8xr
  label: GHSA-whp4-9hfm-h8xr
tags: [dnsjava, java, unicode, dns]
featured: true
draft: false
---

I gave `X25Record` five Unicode decimal digits: `၇၈᥏๓๔`. Java considered every character a digit, so dnsjava accepted the address. After the record went through DNS wire serialization and parsing, the address read back as `GHOST`.

That is the bug: the check accepts a wider set of characters than the byte conversion can preserve. I reproduced it with `dnsjava:dnsjava:3.6.5`. The [published advisory](https://github.com/dnsjava/dnsjava/security/advisories/GHSA-whp4-9hfm-h8xr) lists versions 1.6.0 through 3.6.5 as affected and 3.7.0 as patched.

## Where the address changes

The vulnerable `checkAndConvertAddress` loop checks each UTF-16 `char` with `Character.isDigit`, then casts it directly to a byte:

```java
char c = address.charAt(i);
if (!Character.isDigit(c)) {
    return null;
}
out[i] = (byte) c;
```

[`Character.isDigit(char)` accepts decimal digits from many scripts](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Character.html#isDigit(char)). The cast keeps only the low eight bits of each accepted character. Those bits need not encode an ASCII digit. dnsjava stores the resulting bytes in the record, writes them to the wire, and decodes them as US-ASCII when `getAddress()` is called. The validation happens on one representation; the stored address uses another.

The [X25 RR definition in RFC 1183](https://www.rfc-editor.org/rfc/rfc1183.html#section-3.1) describes the PSDN address as a string of decimal digits in the X.121 numbering plan. For this Java API, accepting Unicode digits and narrowing their code units does not preserve that address.

## Reproducing it

I used this dependency:

```xml
<dependency>
    <groupId>dnsjava</groupId>
    <artifactId>dnsjava</artifactId>
    <version>3.6.5</version>
</dependency>
```

The reproducer builds a record, serializes a DNS message, then parses it again:

```java
import org.xbill.DNS.DClass;
import org.xbill.DNS.Message;
import org.xbill.DNS.Name;
import org.xbill.DNS.Section;
import org.xbill.DNS.X25Record;

public class X25UnicodeReproducer {
    public static void main(String[] args) throws Exception {
        // Myanmar 7, Myanmar 8, Limbu 9, Thai 3, Thai 4.
        // Every character satisfies Character.isDigit().
        String supplied = "\u1047\u1048\u194F\u0E53\u0E54";

        supplied.codePoints().forEach(codePoint ->
                System.out.printf(
                        "U+%04X digit=%s lowByte=0x%02X%n",
                        codePoint,
                        Character.isDigit(codePoint),
                        codePoint & 0xff));

        Name owner = Name.fromString("example.");
        X25Record record =
                new X25Record(owner, DClass.IN, 60, supplied);

        Message outbound = new Message();
        outbound.addRecord(record, Section.ANSWER);

        byte[] wire = outbound.toWire();
        Message inbound = new Message(wire);

        X25Record decoded =
                (X25Record) inbound.getSection(Section.ANSWER).get(0);

        System.out.println("supplied: " + supplied);
        System.out.println("decoded:  " + decoded.getAddress());
    }
}
```

The output shows both halves of the mismatch:

```text
U+1047 digit=true lowByte=0x47
U+1048 digit=true lowByte=0x48
U+194F digit=true lowByte=0x4F
U+0E53 digit=true lowByte=0x53
U+0E54 digit=true lowByte=0x54
supplied: ၇၈᥏๓๔
decoded:  GHOST
```

`0x47 0x48 0x4F 0x53 0x54` are the ASCII bytes for `GHOST`. The constructor accepted the original string as a PSDN address; the serialized record contained something else.

## Impact and limits

This matters when an application accepts an attacker-controlled Unicode string, treats successful `X25Record` construction as validation, makes a decision using the original string, and later uses the record's stored or reparsed value. It could approve a string that Java classifies as digit-only while transmitting different bytes.

X.25 records are uncommon. I have not identified a production application that follows this path, so I am keeping the impact claim narrow. The [maintainers classified the advisory as low severity](https://github.com/dnsjava/dnsjava/security/advisories/GHSA-whp4-9hfm-h8xr).

## Fix and status

The relevant fix is to validate the ASCII range before converting each character:

```java
if (c < '0' || c > '9') {
    return null;
}
out[i] = (byte) c;
```

The [current `X25Record` implementation](https://github.com/dnsjava/dnsjava/blob/master/src/main/java/org/xbill/DNS/X25Record.java) uses that check, and the [3.7.0 release](https://github.com/dnsjava/dnsjava/releases/tag/v3.7.0) includes this advisory. A regression test should cover constructor input, text parsing, wire serialization, and reparsing so that all four paths agree on the address.

The original vulnerable loop is preserved in [this pre-fix source snapshot](https://github.com/dnsjava/dnsjava/blob/06a0599933114f36efe59667cd80ee0246a1a882/src/main/java/org/xbill/DNS/X25Record.java#L21-L30).
