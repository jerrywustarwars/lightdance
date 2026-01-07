#include <bits/stdc++.h>

using namespace std;

// 符合韌體位元格式的封裝函數
unsigned int toFirmwareInt(int r, int g, int b, int bright6bit, int trans, int dir) {
    // 前 24 位元為 RGB 顏色 (R << 16 | G << 8 | B)
    unsigned int color24 = ((unsigned int)(r & 0xFF) << 16) |
                           ((unsigned int)(g & 0xFF) << 8)  |
                           ((unsigned int)(b & 0xFF));
    
    // 封裝格式：| 顏色(24bit) | 亮度(6bit) | 轉場(1bit) | 方向(1bit) |
    unsigned int lastByte = ((bright6bit & 0x3F) << 2) | 
                            ((trans & 0x01) << 1) | 
                            (dir & 0x01);
    
    return (color24 << 8) | lastByte;
}

// 線性插值函數：計算兩個顏色中間的數值
int lerp(int start, int end, float fraction) {
    return (int)(start + (end - start) * fraction);
}

int main() {
    // 初始化隨機種子
    srand(time(NULL));
    
    // 15 個原始部位名稱
    vector<string> bodyParts = {
        "hat", "face", "chestL", "chestR", "armL", "armR", 
        "tie", "belt", "gloveL", "gloveR", "legL", "legR", 
        "shoeL", "shoeR", "board"
    };
    
    int playerCount = 7;
    int dataCount = 20;   // 影格數量
    int partCount = bodyParts.size();

    cout << "{\n  \"players\": [\n";

    for (int p = 0; p < playerCount; p++) {
        // 為每位舞者的每個部位定義隨機起始與結束顏色
        struct Color { int r, g, b; };
        vector<Color> startColors(partCount);
        vector<Color> endColors(partCount);
        
        for(int j = 0; j < partCount; j++) {
            startColors[j] = {rand() % 256, rand() % 256, rand() % 256};
            endColors[j]   = {rand() % 256, rand() % 256, rand() % 256};
        }

        cout << "    [\n";
        for (int i = 0; i < dataCount; i++) {
            // 計算目前影格進度比例 (0.0 到 1.0)
            float fraction = (float)i / (dataCount - 1);
            
            // 每隔 10 個單位時間 (韌體會轉為 500ms)
            int timeValue = i * 10; 

            cout << "      {\"time\": " << timeValue;
            for (int j = 0; j < partCount; j++) {
                // 插值計算 R, G, B
                int r = lerp(startColors[j].r, endColors[j].r, fraction);
                int g = lerp(startColors[j].g, endColors[j].g, fraction);
                int b = lerp(startColors[j].b, endColors[j].b, fraction);
                
                int brightness = 63; // 6-bit 最大亮度
                int trans = 1;      // 開啟轉場旗標
                int dir = 0;
                
                unsigned int val = toFirmwareInt(r, g, b, brightness, trans, dir);
                
                // 改為十進位輸出，不帶 0x 與 引號
                cout << ", \"" << bodyParts[j] << "\": " << val;
            }
            cout << "}" << (i == dataCount - 1 ? "" : ",") << "\n";
        }
        cout << "    ]" << (p == playerCount - 1 ? "" : ",") << "\n";
    }

    cout << "  ]\n}";
    return 0;
}